import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import type { PipelineContext } from "jive-abstract-library";
import { AppExpoSchema, type AppExpoConfig } from "../public/manifest";
import { Promotion, deployableEnvironments, deploymentId, planWebDeployment } from "./web-target";

const decode = Schema.decodeUnknownSync(AppExpoSchema);

function config(overrides: Record<string, unknown> = {}): AppExpoConfig {
  return decode({
    web: { subdomain: "my-app", customDomain: null },
    native: { platforms: [], distribution: "internal" },
    environments: {
      Production: { web: "production", easEnvironment: "production", variables: { EXPO_PUBLIC_SERVER_URL: "https://api.example.com" } },
      Staging: { web: { alias: "staging" }, easEnvironment: "preview", variables: {} },
    },
    preview: { easEnvironment: "preview", variables: {} },
    ...overrides,
  });
}

const sha = "1A2B3C4D5E6F708192a3b4c5d6e7f80912345678";
const pullRequest: PipelineContext = {
  provider: "Github",
  repository: { owner: "jive-sh", name: "app" },
  sourceBranch: "feature/x",
  sourceCommitSha: sha,
  event: { type: "PULL_REQUEST", id: "42", destinationBranch: "main" },
};
const manualRun: PipelineContext = { ...pullRequest, sourceBranch: "Feature/Some_Thing", event: { type: "DIRECT_WORKFLOW_RUN" } };

describe("planWebDeployment", () => {
  const plan = (environment: string, context: PipelineContext = pullRequest, overrides: Record<string, unknown> = {}) =>
    planWebDeployment({ config: config(overrides), environment, context });

  test("production is promoted and served at the project's own subdomain", () => {
    expect(Option.getOrThrow(plan("Production"))).toEqual({
      id: "production-1a2b3c4d",
      promotion: Promotion.Production(),
      url: "https://my-app.expo.app/",
    });
  });

  test("production is served at the custom domain once one is configured", () => {
    const configured = plan("Production", pullRequest, { web: { subdomain: "my-app", customDomain: "example.com" } });
    expect(Option.getOrThrow(configured).url).toBe("https://example.com/");
  });

  test("an aliased environment is served at <subdomain>--<alias>", () => {
    expect(Option.getOrThrow(plan("Staging"))).toEqual({
      id: "alias-staging-1a2b3c4d",
      promotion: Promotion.Alias({ alias: "staging" }),
      url: "https://my-app--staging.expo.app/",
    });
  });

  test("a pull request preview is its own deployment per commit, with no alias", () => {
    expect(Option.getOrThrow(plan("Preview"))).toEqual({
      id: "pr-42-1a2b3c4d",
      promotion: Promotion.None(),
      url: "https://my-app--pr-42-1a2b3c4d.expo.app/",
    });
  });

  test("a manual run's preview is named after its branch, as a DNS label", () => {
    expect(Option.getOrThrow(plan("Preview", manualRun)).id).toBe("branch-feature-some-thing-1a2b3c4d");
  });

  test("an id is cut so the whole <subdomain>--<id> host label stays within 63 characters", () => {
    const subdomain = "a-fairly-long-subdomain";
    const id = deploymentId({ source: `branch-${"x".repeat(200)}`, context: manualRun, subdomain });
    expect(`${subdomain}--${id}`.length).toBeLessThanOrEqual(63);
    expect(id.endsWith("-1a2b3c4d")).toBe(true);
  });

  test("an environment the package does not configure has no plan", () => {
    expect(Option.isNone(plan("Elsewhere"))).toBe(true);
    expect(Option.isNone(plan("Preview", pullRequest, { preview: null }))).toBe(true);
  });
});

describe("deployableEnvironments", () => {
  test("lists configured environments, then Preview only when previews are configured", () => {
    expect(deployableEnvironments(config()).map(({ name }) => name)).toEqual(["Production", "Staging", "Preview"]);
    expect(deployableEnvironments(config({ preview: null })).map(({ name }) => name)).toEqual(["Production", "Staging"]);
  });
});
