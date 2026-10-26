import { afterAll, beforeAll, describe, expect, test as buntest } from "bun:test";
import { Effect, FileSystem, Layer, Option, pipe } from "effect";
import { effunct, type EffectGen } from "effective-modules";
import { join } from "node:path";
import { Promotion } from "../../hosting/web-target";
import { AppExpoModules, appExpoModules } from "../index";
import type { ProcessInput, ProcessResult } from "../process/interface";
import { ProcessImpl } from "../process/impl";
import { EasImpl, UPDATE_EXPORT_DIR } from "./impl";

/**
 * EasImpl against eas-cli output recorded from a real project (see recorded/README.md): each test scripts what
 * the CLI prints and checks the arguments this module passed and what it made of the answer.
 */

const recorded = (file: string) => Bun.file(join(import.meta.dir, "recorded", file)).text();

function test(name: string, body: () => EffectGen<void, any, never>) {
  buntest(name, async () => { await Effect.runPromise(effunct(body)()); });
}

/** Runs `program` with eas answering each call from `answers`, in order, and returns the argv it was given. */
function withEas<A>(
  answers: ReadonlyArray<ProcessResult>,
  program: () => EffectGen<A, string, AppExpoModules.Eas>,
): Effect.Effect<{ readonly value: A; readonly calls: ReadonlyArray<ProcessInput> }, string> {
  const calls: Array<ProcessInput> = [];
  const process = ProcessImpl.mockLayer({
    *result(input: ProcessInput): EffectGen<ProcessResult, string> {
      calls.push(input);
      const answer = answers[calls.length - 1];
      if (answer === undefined) return yield* Effect.fail(`unexpected eas call ${calls.length}: ${input.args.join(" ")}`);
      return answer;
    },
  });
  const fileSystem = FileSystem.layerNoop({ exists: () => Effect.succeed(true) });
  return pipe(
    effunct(program)(),
    Effect.map((value) => ({ value, calls })),
    Effect.provide(pipe(EasImpl.Layer, Layer.provide(Layer.mergeAll(process, fileSystem)))),
  );
}

const ok = (stdout: string): ProcessResult => ({ exitCode: 0, stdout, stderr: "" });

const stagingDeploy = {
  exportDir: "dist/web/Staging",
  subdomain: "jive-abstract-app-expo-fixture",
  id: "repro-alias-1",
  promotion: Promotion.Alias({ alias: "staging" }),
  easEnvironment: "preview",
};

let savedToken: string | undefined;
beforeAll(() => { savedToken = process.env["EXPO_TOKEN"]; process.env["EXPO_TOKEN"] = "test-token"; });
afterAll(() => { if (savedToken === undefined) delete process.env["EXPO_TOKEN"]; else process.env["EXPO_TOKEN"] = savedToken; });

describe("deployWeb", () => {
  test("deploys with the per-commit id and alias, and reports the alias URL", function* () {
    const { value, calls } = yield* withEas([ok(yield* Effect.promise(() => recorded("deploy-alias.json")))], function* () {
      return yield* (yield* appExpoModules.Eas).deployWeb(stagingDeploy);
    });
    expect(value).toEqual({ identifier: "repro-alias-1", url: "https://jive-abstract-app-expo-fixture--staging.expo.app" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual([
      "deploy", "--export-dir", "dist/web/Staging", "--dev-domain", "jive-abstract-app-expo-fixture",
      "--environment", "preview", "--id", "repro-alias-1", "--alias", "staging", "--json", "--non-interactive",
    ]);
  });

  test("on a rerun of the same commit, points the alias at the deployment that already exists", function* () {
    const existing: ProcessResult = { exitCode: 1, stdout: "", stderr: yield* Effect.promise(() => recorded("deploy-existing.stderr.txt")) };
    const { value, calls } = yield* withEas([existing, ok(yield* Effect.promise(() => recorded("deploy-alias.json")))], function* () {
      return yield* (yield* appExpoModules.Eas).deployWeb(stagingDeploy);
    });
    expect(value.url).toBe("https://jive-abstract-app-expo-fixture--staging.expo.app");
    expect(calls[1]!.args).toEqual(["deploy:alias", "--id", "repro-alias-1", "--alias", "staging", "--json", "--non-interactive"]);
  });

  test("on a rerun of an unaliased preview, reuses the deployment without another call", function* () {
    const existing: ProcessResult = { exitCode: 1, stdout: "", stderr: yield* Effect.promise(() => recorded("deploy-existing.stderr.txt")) };
    const { value, calls } = yield* withEas([existing], function* () {
      return yield* (yield* appExpoModules.Eas).deployWeb({ ...stagingDeploy, promotion: Promotion.None() });
    });
    expect(value.url).toBe("https://jive-abstract-app-expo-fixture--repro-alias-1.expo.app/");
    expect(calls).toHaveLength(1);
  });

  test("fails with EAS's message on any other error", function* () {
    const result = yield* Effect.result(withEas([{ exitCode: 1, stdout: "", stderr: "Entity not authorized" }], function* () {
      return yield* (yield* appExpoModules.Eas).deployWeb(stagingDeploy);
    }));
    expect(result._tag).toBe("Failure");
    expect(result._tag === "Failure" ? result.failure : "").toContain("Entity not authorized");
  });
});

describe("findBuild", () => {
  const find = function* () {
    return yield* (yield* appExpoModules.Eas).findBuild({ platform: "android", profile: "staging", runtimeVersion: "1.0.0" });
  };

  test("finds a build still in progress, so no second one is started", function* () {
    const { value, calls } = yield* withEas([ok(yield* Effect.promise(() => recorded("build-list-in-progress.json")))], find);
    expect(Option.getOrThrow(value)).toEqual({ id: "41ff85c5-10d3-4adc-93a8-bfed79e7e629", status: "IN_PROGRESS" });
    expect(calls[0]!.args).toEqual([
      "build:list", "--platform", "android", "--build-profile", "staging", "--runtime-version", "1.0.0",
      "--limit", "10", "--json", "--non-interactive",
    ]);
  });

  test("finds nothing when the only builds failed or were cancelled", function* () {
    const builds = JSON.parse(yield* Effect.promise(() => recorded("build-list-in-progress.json")));
    const cancelled = JSON.stringify(builds.map((build: object) => ({ ...build, status: "CANCELED" })));
    expect(Option.isNone((yield* withEas([ok(cancelled)], find)).value)).toBe(true);
    expect(Option.isNone((yield* withEas([ok(yield* Effect.promise(() => recorded("build-list-empty.json")))], find)).value)).toBe(true);
  });
});

test("an update bundles into its own folder, so it cannot delete the web exports", function* () {
  const { calls } = yield* withEas([ok("[]")], function* () {
    yield* (yield* appExpoModules.Eas).publishUpdate({
      platform: "android",
      channel: "staging",
      easEnvironment: "preview",
      message: "main@abc",
      variables: { EXPO_PUBLIC_ENVIRONMENT_LABEL: "Staging" },
    });
  });
  expect(calls[0]!.args).toContain(UPDATE_EXPORT_DIR);
  expect(calls[0]!.args.slice(calls[0]!.args.indexOf("--input-dir"))[1]).toBe(UPDATE_EXPORT_DIR);
  expect(calls[0]!.env).toEqual({ EXPO_PUBLIC_ENVIRONMENT_LABEL: "Staging" });
});
