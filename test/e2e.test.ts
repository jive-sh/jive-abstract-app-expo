import { afterAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

/**
 * Runs every hook against the fixture app in test/fixture, the way Jive's pipeline does, and checks what
 * each live URL serves. Needs EXPO_TOKEN for the fixture's EAS project. Every web deployment it creates is
 * deleted afterwards; the fixture's builds stay, so later runs only publish updates.
 */

const FIXTURE_DIR = resolve(import.meta.dir, "fixture");
const ENVIRONMENT_LABEL_VARIABLE = "EXPO_PUBLIC_ENVIRONMENT_LABEL";
const TIMEOUT = 20 * 60 * 1000;

const runId = `${Date.now().toString(16)}${Math.floor(Math.random() * 0xffff).toString(16)}`.padEnd(40, "0").slice(0, 40);

function pipelineContext(event: "PULL_REQUEST" | "COMMIT") {
  return JSON.stringify({
    provider: "Github",
    repository: { owner: "jive-sh", name: "jive-abstract-app-expo" },
    sourceBranch: event === "PULL_REQUEST" ? "e2e" : "main",
    sourceCommitSha: runId,
    event: event === "PULL_REQUEST" ? { type: "PULL_REQUEST", id: "e2e", destinationBranch: "main" } : { type: "COMMIT" },
  });
}

function hook(script: string, env: Record<string, string> = {}): string {
  const result = Bun.spawnSync(["bun", "run", script], {
    cwd: FIXTURE_DIR,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "inherit",
  });
  const stdout = result.stdout.toString();
  if (result.exitCode !== 0) throw new Error(`${script} exited with code ${result.exitCode}:\n${stdout}`);
  return stdout;
}

function eas(args: ReadonlyArray<string>): void {
  const result = Bun.spawnSync([resolve(FIXTURE_DIR, "node_modules", ".bin", "eas"), ...args], {
    cwd: FIXTURE_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) process.stderr.write(`cleanup: eas ${args.join(" ")} failed:\n${result.stderr.toString()}\n`);
}

/** The label a deployed web app shows, read from the bundle its index.html loads. */
async function servedLabel(url: string): Promise<string> {
  const html = await (await fetch(url)).text();
  const script = /<script[^>]+src="([^"]+\.js)"/.exec(html)?.[1];
  if (script === undefined) throw new Error(`${url} served no script tag:\n${html.slice(0, 500)}`);
  const bundle = await (await fetch(new URL(script, url))).text();
  for (const label of ["Preview", "Staging", "Production"]) {
    if (bundle.includes(`"${label}"`)) return label;
  }
  throw new Error(`${url}'s bundle shows no environment label`);
}

const sha8 = runId.slice(0, 8);
/** The ids the deploy hook gives this run's deployments (see planWebDeployment), deleted afterwards. */
const deploymentIds = [`pr-e2e-${sha8}`, `alias-staging-${sha8}`, `production-${sha8}`];

function deploy(environment: string, event: "PULL_REQUEST" | "COMMIT"): string {
  const env = { JIVE_DEPLOY_ENVIRONMENT: environment, JIVE_PIPELINE_CONTEXT: pipelineContext(event) };
  const url = hook("jive:cicd:deploy:url", env).trim();
  hook("jive:cicd:upload-artifacts", { JIVE_PIPELINE_CONTEXT: env.JIVE_PIPELINE_CONTEXT });
  hook("jive:cicd:deploy", env);
  return url;
}

describe.skipIf(!process.env["EXPO_TOKEN"])(`the hooks deploy ${FIXTURE_DIR}`, () => {
  test("get-config prints the validated jive block and nothing else", () => {
    const config = JSON.parse(hook("jive:cicd:get-config"));
    expect(Object.keys(config).sort()).toEqual(["app-expo", "cicd"]);
  });

  test("build and audit export the web app once per environment", () => {
    hook("jive:cicd:build");
    hook("jive:cicd:audit");
  }, TIMEOUT);

  test("a pull request deploys a preview with its own variables, at the URL deploy:url announced", async () => {
    const url = deploy("Preview", "PULL_REQUEST");
    expect(url).toContain(`--pr-e2e-${sha8}.`);
    expect(await servedLabel(url)).toBe("Preview");
  }, TIMEOUT);

  test("rerunning a deploy for the same commit succeeds, as a pipeline rerun does", () => {
    deploy("Preview", "PULL_REQUEST");
  }, TIMEOUT);

  test("a branch deploys Staging to its alias, with its own variables, and updates the Android app", async () => {
    const url = deploy("Staging", "COMMIT");
    expect(url).toContain("--staging.");
    expect(await servedLabel(url)).toBe("Staging");
  }, TIMEOUT);

  test("Production is promoted to the project's own subdomain", async () => {
    const url = deploy("Production", "COMMIT");
    expect(await servedLabel(url)).toBe("Production");
  }, TIMEOUT);

  afterAll(() => {
    eas(["deploy:alias:delete", "staging", "--non-interactive"]);
    for (const id of deploymentIds) eas(["deploy:delete", id, "--non-interactive"]);
  });
});

test.skipIf(!!process.env["EXPO_TOKEN"])("the end-to-end test needs EXPO_TOKEN", () => {
  throw new Error(`Set ${"EXPO_TOKEN"} to an Expo access token for the fixture's EAS project to run the end-to-end test; ${ENVIRONMENT_LABEL_VARIABLE} labels tell its deployments apart`);
});
