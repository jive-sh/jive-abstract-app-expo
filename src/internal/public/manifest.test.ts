import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { CicdSchema } from "jive-abstract-library";
import { ABSTRACT_KEY, AppExpoSchema, PackageJsonSchema, crossFieldErrors } from "./manifest";

const cicd = (branches: Record<string, ReadonlyArray<string>>, previews: boolean) => Schema.decodeUnknownSync(CicdSchema)({
  deploy: { verb: "Deploy to", branches, previews, sequentially: true },
  runsOnPullRequests: true,
  runsOn: "ubuntu-latest",
});

const appExpo = (input: Record<string, unknown>) => Schema.decodeUnknownSync(AppExpoSchema)({
  web: { subdomain: "my-app", customDomain: null },
  native: { platforms: ["android"], distribution: "internal" },
  environments: {},
  preview: null,
  ...input,
});

const production = { web: "production", easEnvironment: "production", variables: {} };

describe("AppExpoSchema", () => {
  test("rejects a variable Expo would not inline", () => {
    expect(() => appExpo({ environments: { Production: { ...production, variables: { SERVER_URL: "x" } } } })).toThrow();
  });

  test("rejects a subdomain or alias EAS would rewrite", () => {
    expect(() => appExpo({ web: { subdomain: "My_App", customDomain: null } })).toThrow();
    expect(() => appExpo({ environments: { Staging: { ...production, web: { alias: "Staging" } } } })).toThrow();
  });

  test("rejects an EAS environment eas.json cannot name", () => {
    expect(() => appExpo({ environments: { Production: { ...production, easEnvironment: "staging" } } })).toThrow();
  });
});

describe("crossFieldErrors", () => {
  test("accepts a manifest whose environments match its branches", () => {
    expect(crossFieldErrors(cicd({ main: ["Production"] }, false), appExpo({ environments: { Production: production } }))).toEqual([]);
  });

  test("names every environment deployed but not configured, and configured but not deployed", () => {
    const errors = crossFieldErrors(cicd({ main: ["Production", "Staging"] }, false), appExpo({ environments: { Production: production, Old: { ...production, web: { alias: "old" } } } }));
    expect(errors).toHaveLength(2);
    expect(errors.join("\n")).toContain('"Staging"');
    expect(errors.join("\n")).toContain('"Old"');
  });

  test("requires the preview block exactly when previews are on", () => {
    const environments = { Production: production };
    expect(crossFieldErrors(cicd({ main: ["Production"] }, true), appExpo({ environments }))).toHaveLength(1);
    expect(crossFieldErrors(cicd({ main: ["Production"] }, false), appExpo({ environments, preview: { easEnvironment: "preview", variables: {} } }))).toHaveLength(1);
  });

  test("allows one production environment and one environment per alias", () => {
    const errors = crossFieldErrors(cicd({ main: ["A", "B", "C", "D"] }, false), appExpo({
      environments: {
        A: production,
        B: production,
        C: { ...production, web: { alias: "same" } },
        D: { ...production, web: { alias: "same" } },
      },
    }));
    expect(errors).toHaveLength(2);
  });
});

describe("the rendered package.schema.json", () => {
  test("describes each environment's fields, so the editor checks them as they are typed", () => {
    const document = Schema.toJsonSchemaDocument(PackageJsonSchema);
    const appExpo = (document.schema as any).properties.jive.properties[ABSTRACT_KEY].properties;
    expect(Object.keys(appExpo.environments.additionalProperties.properties).sort()).toEqual(["easEnvironment", "variables", "web"]);
    expect(appExpo.environments.additionalProperties.properties.variables.propertyNames.pattern).toBe("^EXPO_PUBLIC_[A-Z0-9_]+$");
  });
});
