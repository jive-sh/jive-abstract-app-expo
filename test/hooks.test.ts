import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Runs the hooks against the fixture app in test/fixture the way Jive's pipeline does, up to the point where
 * they would contact EAS: this repository is a library and never deploys. What happens on EAS is covered by
 * src/internal/modules/eas/impl.test.ts, against eas-cli output recorded from a real project, and live by the
 * first app's own pipeline.
 */

const FIXTURE_DIR = resolve(import.meta.dir, "fixture");
const LABELS = ["Staging", "Production", "Preview"] as const;
const TIMEOUT = 10 * 60 * 1000;

const pullRequest = JSON.stringify({
  provider: "Github",
  repository: { owner: "jive-sh", name: "jive-abstract-app-expo" },
  sourceBranch: "feature",
  sourceCommitSha: "1a2b3c4d5e6f708192a3b4c5d6e7f80912345678",
  event: { type: "PULL_REQUEST", id: "7", destinationBranch: "main" },
});

function hook(script: string, env: Record<string, string | undefined> = {}) {
  const result = Bun.spawnSync(["bun", "run", script], {
    cwd: FIXTURE_DIR,
    env: { ...process.env, EXPO_TOKEN: undefined, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

/** The one environment label inlined into an export's JavaScript bundle. */
function labelsIn(environment: string): ReadonlyArray<string> {
  const dir = join(FIXTURE_DIR, "dist", "web", environment, "_expo", "static", "js", "web");
  const bundle = readdirSync(dir).map((file) => readFileSync(join(dir, file), "utf8")).join("\n");
  return LABELS.filter((label) => bundle.includes(`"${label}"`));
}

describe("the hooks, run against test/fixture", () => {
  test("get-config prints only the validated jive block on stdout", () => {
    const { exitCode, stdout } = hook("jive:cicd:get-config");
    expect(exitCode).toBe(0);
    expect(Object.keys(JSON.parse(stdout)).sort()).toEqual(["app-expo", "cicd"]);
  });

  test("build exports each environment with its own variables, and audit accepts the result", () => {
    const build = hook("jive:cicd:build");
    expect(build.exitCode, build.stderr).toBe(0);
    for (const environment of LABELS) expect(labelsIn(environment)).toEqual([environment]);
    const easJson = JSON.parse(readFileSync(join(FIXTURE_DIR, "eas.json"), "utf8"));
    expect(Object.keys(easJson.build).sort()).toEqual(["production", "staging"]);
    expect(hook("jive:cicd:audit").exitCode).toBe(0);
  }, TIMEOUT);

  test("deploy:url prints exactly one URL per environment and refuses an unknown one", () => {
    const urls = Object.fromEntries(LABELS.map((environment) => [
      environment,
      hook("jive:cicd:deploy:url", { JIVE_DEPLOY_ENVIRONMENT: environment, JIVE_PIPELINE_CONTEXT: pullRequest }).stdout,
    ]));
    expect(urls).toEqual({
      Staging: "https://jive-abstract-app-expo-fixture--staging.expo.app/\n",
      Production: "https://jive-abstract-app-expo-fixture.expo.app/\n",
      Preview: "https://jive-abstract-app-expo-fixture--pr-7-1a2b3c4d.expo.app/\n",
    });
    const unknown = hook("jive:cicd:deploy:url", { JIVE_DEPLOY_ENVIRONMENT: "Elsewhere", JIVE_PIPELINE_CONTEXT: pullRequest });
    expect(unknown.exitCode).not.toBe(0);
    expect(unknown.stdout).toBe("");
  });

  test("deploy stops before contacting EAS when the pipeline gave it no Expo token", () => {
    const { exitCode, stderr } = hook("jive:cicd:deploy", { JIVE_DEPLOY_ENVIRONMENT: "Preview", JIVE_PIPELINE_CONTEXT: pullRequest });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("EXPO_TOKEN is not set");
  });
});
