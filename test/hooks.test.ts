import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GENERATED_APP_CONFIG_FILE, nativeLinkingConfig, renderAppConfig } from "../src/internal/linking/app-config";
import { AppExpoSchema } from "../src/internal/public/manifest";

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
    expect(readdirSync(FIXTURE_DIR)).not.toContain(GENERATED_APP_CONFIG_FILE);
    expect(hook("jive:cicd:audit").exitCode).toBe(0);
  }, TIMEOUT);

  test("deploy:plan plans a deploy to exactly one URL per environment and refuses an unknown one", () => {
    const urls = Object.fromEntries(LABELS.map((environment) => [
      environment,
      hook("jive:cicd:deploy:plan", { JIVE_DEPLOY_ENVIRONMENT: environment, JIVE_PIPELINE_CONTEXT: pullRequest }).stdout,
    ]));
    expect(urls).toEqual({
      Staging: '{"deploy":true,"url":"https://jive-abstract-app-expo-fixture--staging.expo.app/"}\n',
      Production: '{"deploy":true,"url":"https://jive-abstract-app-expo-fixture.expo.app/"}\n',
      Preview: '{"deploy":true,"url":"https://jive-abstract-app-expo-fixture--pr-7-1a2b3c4d.expo.app/"}\n',
    });
    const unknown = hook("jive:cicd:deploy:plan", { JIVE_DEPLOY_ENVIRONMENT: "Elsewhere", JIVE_PIPELINE_CONTEXT: pullRequest });
    expect(unknown.exitCode).not.toBe(0);
    expect(unknown.stdout).toBe("");
  });

  test("Expo builds the generated config's universal links into the Android manifest and iOS entitlements", () => {
    // The fixture keeps customDomain null so no run of its pipeline could register a domain on its real EAS
    // project; this writes what build would generate for a domain on both platforms.
    const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, "package.json"), "utf8"));
    const config = Schema.decodeUnknownSync(AppExpoSchema)({
      ...fixture.jive["app-expo"],
      web: { ...fixture.jive["app-expo"].web, customDomain: "fixture.example.com" },
      native: { ...fixture.jive["app-expo"].native, platforms: ["ios", "android"] },
    });
    const generated = join(FIXTURE_DIR, GENERATED_APP_CONFIG_FILE);
    writeFileSync(generated, renderAppConfig(Option.getOrThrow(nativeLinkingConfig(config))));
    try {
      const result = Bun.spawnSync([join(FIXTURE_DIR, "node_modules", ".bin", "expo"), "config", "--json", "--type", "introspect"], { cwd: FIXTURE_DIR, stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      const { modResults } = JSON.parse(result.stdout.toString())._internal;
      const activity = modResults.android.manifest.manifest.application[0].activity[0];
      expect(activity["intent-filter"].filter((filter: any) => filter.$?.["android:autoVerify"] === "true")).toEqual([{
        $: { "android:autoVerify": "true", "data-generated": "true" },
        action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
        data: [{ $: { "android:scheme": "https", "android:host": "fixture.example.com" } }],
        category: [{ $: { "android:name": "android.intent.category.BROWSABLE" } }, { $: { "android:name": "android.intent.category.DEFAULT" } }],
      }]);
      expect(modResults.ios.entitlements["com.apple.developer.associated-domains"]).toEqual(["applinks:fixture.example.com"]);
    } finally {
      rmSync(generated, { force: true });
    }
  }, TIMEOUT);

  test("deploy stops before contacting EAS when the pipeline gave it no Expo token", () => {
    const { exitCode, stderr } = hook("jive:cicd:deploy", { JIVE_DEPLOY_ENVIRONMENT: "Preview", JIVE_PIPELINE_CONTEXT: pullRequest });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("EXPO_TOKEN is not set");
  });
});
