import { describe, expect, test as buntest } from "bun:test";
import { Effect, Layer, Option, Schema, pipe } from "effect";
import { effunct, type EffectGen } from "effective-modules";
import type { PipelineContext } from "jive-abstract-library";
import { Promotion } from "../../hosting/web-target";
import { PackageJsonSchema, type NativePlatform, type PackageJson } from "../../public/manifest";
import { EasImpl } from "../eas/impl";
import type { NativeBuild, WebDeployment } from "../eas/interface";
import { ExpoImpl } from "../expo/impl";
import type { AppConfig } from "../expo/interface";
import { AppExpoModules, appExpoModules } from "../index";
import { PackageImpl } from "../package/impl";
import { DeployerImpl } from "./impl";

function test(name: string, body: () => EffectGen<void, any, never>) {
  buntest(name, async () => { await Effect.runPromise(effunct(body)()); });
}

const packageJson: PackageJson = Schema.decodeUnknownSync(PackageJsonSchema)({
  $schema: "./package.schema.json",
  name: "my-app",
  version: "1.0.0",
  license: "MIT",
  scripts: Object.fromEntries(["get-config", "build", "audit", "deploy:url", "upload-artifacts", "deploy"].map((hook) => [`jive:cicd:${hook}`, `jive-app-expo cicd ${hook}`])),
  jive: {
    cicd: {
      deploy: { verb: "Deploy to", branches: { main: ["Staging", "Production"] }, previews: true, sequentially: true },
      runsOnPullRequests: true,
      runsOn: "ubuntu-latest",
      requiredSecrets: ["EXPO_TOKEN"],
    },
    "app-expo": {
      web: { subdomain: "my-app", customDomain: null },
      native: { platforms: ["android"], distribution: "internal" },
      environments: {
        Staging: { web: { alias: "staging" }, easEnvironment: "preview", variables: { EXPO_PUBLIC_LABEL: "Staging" } },
        Production: { web: "production", easEnvironment: "production", variables: {} },
      },
      preview: { easEnvironment: "preview", variables: {} },
    },
  },
});

const appConfig: AppConfig = {
  slug: "my-app",
  version: "1.0.0",
  owner: Option.some("jive-sh"),
  projectId: Option.some("00000000-0000-0000-0000-000000000000"),
  runtimeVersion: Option.some("1.0.0"),
  updatesUrl: Option.some("https://u.expo.dev/00000000-0000-0000-0000-000000000000"),
  androidPackage: Option.some("sh.jive.myapp"),
  iosBundleIdentifier: Option.none(),
};

const commit: PipelineContext = {
  provider: "Github",
  repository: { owner: "jive-sh", name: "app" },
  sourceBranch: "main",
  sourceCommitSha: "1a2b3c4d5e6f708192a3b4c5d6e7f80912345678",
  event: { type: "COMMIT" },
};
const pullRequest: PipelineContext = { ...commit, sourceBranch: "feature", event: { type: "PULL_REQUEST", id: "42", destinationBranch: "main" } };

type Call = { readonly method: string; readonly input: unknown };

/** Deploys one environment against fake Package, Expo and EAS modules, returning every EAS call in order. */
function deployWith(input: {
  readonly environment: string;
  readonly context: PipelineContext;
  readonly servedUrl: string;
  readonly existingBuild: Option.Option<NativeBuild>;
}): Effect.Effect<ReadonlyArray<Call>, string> {
  const calls: Array<Call> = [];
  const eas = EasImpl.mockLayer({
    *deployWeb(request): EffectGen<WebDeployment, string> {
      calls.push({ method: "deployWeb", input: request });
      return { identifier: request.id, url: input.servedUrl };
    },
    *findBuild(request): EffectGen<Option.Option<NativeBuild>, string> {
      calls.push({ method: "findBuild", input: request });
      return input.existingBuild;
    },
    *startBuild(request: { readonly platform: NativePlatform; readonly profile: string; readonly message: string }): EffectGen<NativeBuild, string> {
      calls.push({ method: "startBuild", input: request });
      return { id: "new-build", status: "NEW" };
    },
    *publishUpdate(request): EffectGen<void, string> {
      calls.push({ method: "publishUpdate", input: request });
    },
  });
  const pkg = PackageImpl.mockLayer({ *load(): EffectGen<PackageJson, string> { return packageJson; } });
  const expo = ExpoImpl.mockLayer({ *readAppConfig(): EffectGen<AppConfig, string> { return appConfig; } });
  return pipe(
    effunct(function* (): EffectGen<void, string, AppExpoModules.Deployer> {
      yield* (yield* appExpoModules.Deployer).deploy({ environment: input.environment, context: input.context });
    })(),
    Effect.map(() => calls),
    Effect.provide(pipe(DeployerImpl.Layer, Layer.provide(Layer.mergeAll(eas, pkg, expo)))),
  );
}

describe("deploy", () => {
  test("a branch environment deploys its web export, then builds Android once and publishes an update to its channel", function* () {
    const calls = yield* deployWith({ environment: "Staging", context: commit, servedUrl: "https://my-app--staging.expo.app", existingBuild: Option.none() });
    expect(calls.map(({ method }) => method)).toEqual(["deployWeb", "findBuild", "startBuild", "publishUpdate"]);
    expect(calls[0]!.input).toEqual({
      exportDir: "dist/web/Staging",
      subdomain: "my-app",
      id: "alias-staging-1a2b3c4d",
      promotion: Promotion.Alias({ alias: "staging" }),
      easEnvironment: "preview",
    });
    expect(calls[1]!.input).toEqual({ platform: "android", profile: "staging", runtimeVersion: "1.0.0" });
    expect(calls[3]!.input).toEqual({
      platform: "android",
      channel: "staging",
      easEnvironment: "preview",
      message: "main@1a2b3c4d5e6f708192a3b4c5d6e7f80912345678",
      variables: { EXPO_PUBLIC_LABEL: "Staging" },
    });
  });

  test("a build already made for the runtime version is reused, and only an update is published", function* () {
    const calls = yield* deployWith({
      environment: "Production",
      context: commit,
      servedUrl: "https://my-app.expo.app",
      existingBuild: Option.some({ id: "old-build", status: "FINISHED" }),
    });
    expect(calls.map(({ method }) => method)).toEqual(["deployWeb", "findBuild", "publishUpdate"]);
  });

  test("a pull request deploys the web app only", function* () {
    const calls = yield* deployWith({ environment: "Preview", context: pullRequest, servedUrl: "https://my-app--pr-42-1a2b3c4d.expo.app", existingBuild: Option.none() });
    expect(calls.map(({ method }) => method)).toEqual(["deployWeb"]);
  });

  test("fails, before touching native apps, when EAS serves the web app somewhere deploy:url did not announce", function* () {
    const result = yield* Effect.result(deployWith({ environment: "Staging", context: commit, servedUrl: "https://my-app--elsewhere.expo.app", existingBuild: Option.none() }));
    expect(result._tag).toBe("Failure");
    expect(result._tag === "Failure" ? result.failure : "").toContain("deploy:url announced https://my-app--staging.expo.app/");
  });

  test("refuses an environment the package does not deploy", function* () {
    const result = yield* Effect.result(deployWith({ environment: "Elsewhere", context: commit, servedUrl: "", existingBuild: Option.none() }));
    expect(result._tag).toBe("Failure");
  });
});
