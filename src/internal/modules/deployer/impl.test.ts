import { describe, expect, test as buntest } from "bun:test";
import { Effect, FileSystem, Layer, Option, Schema, pipe } from "effect";
import { effunct, type EffectGen } from "effective-modules";
import type { PipelineContext } from "jive-abstract-library";
import { Promotion } from "../../hosting/web-target";
import { PackageJsonSchema, type NativePlatform, type PackageJson } from "../../public/manifest";
import { CustomDomainsImpl } from "../custom-domains/impl";
import { CustomDomainChange, type CustomDomain, type CustomDomainChange as Change } from "../custom-domains/interface";
import { EasImpl } from "../eas/impl";
import type { NativeBuild, WebDeployment } from "../eas/interface";
import { ExpoImpl } from "../expo/impl";
import type { AppConfig } from "../expo/interface";
import { AppExpoModules, appExpoModules } from "../index";
import { PackageImpl } from "../package/impl";
import { SigningCredentialsImpl } from "../signing-credentials/impl";
import { DeployerImpl } from "./impl";

function test(name: string, body: () => EffectGen<void, any, never>) {
  buntest(name, async () => { await Effect.runPromise(effunct(body)()); });
}

const FINGERPRINT = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");

function packageJson(input: { readonly domain: string | null }, platforms: ReadonlyArray<NativePlatform> = ["android"]): PackageJson {
  return Schema.decodeUnknownSync(PackageJsonSchema)({
    $schema: "./package.schema.json",
    name: "my-app",
    version: "1.0.0",
    license: "MIT",
    scripts: Object.fromEntries(["get-config", "build", "audit", "deploy:plan", "upload-artifacts", "deploy"].map((hook) => [`jive:cicd:${hook}`, `jive-app-expo cicd ${hook}`])),
    jive: {
      cicd: {
        deploy: { verb: "Deploy to", branches: { main: ["Staging", "Production"] }, previews: true, sequentially: true },
        runsOnPullRequests: true,
        runsOn: "ubuntu-latest",
        requiredSecrets: ["EXPO_TOKEN"],
      },
      "app-expo": {
        web: { subdomain: "my-app" },
        domain: input.domain,
        native: { platforms, distribution: "internal" },
        environments: {
          Staging: { web: { alias: "staging" }, easEnvironment: "preview", variables: { EXPO_PUBLIC_LABEL: "Staging" } },
          Production: { web: "production", easEnvironment: "production", variables: {} },
        },
        preview: { easEnvironment: "preview", variables: {} },
      },
    },
  });
}

const appConfig: AppConfig = {
  slug: "my-app",
  version: "1.0.0",
  owner: Option.some("jive-sh"),
  projectId: Option.some("00000000-0000-0000-0000-000000000000"),
  runtimeVersion: Option.some("1.0.0"),
  updatesUrl: Option.some("https://u.expo.dev/00000000-0000-0000-0000-000000000000"),
  androidPackage: Option.some("sh.jive.myapp"),
  iosBundleIdentifier: Option.some("sh.jive.myapp"),
};

const registeredDomain: CustomDomain = {
  id: "domain-1",
  hostname: "app.example.com",
  records: [{ purpose: "routing", type: "CNAME", name: "app.example.com", content: "my-app.expo.app", isConfigured: false }],
  setup: Option.some({ status: "PENDING", verificationStatus: Option.none(), sslStatus: Option.none(), errors: [] }),
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

/** Deploys one environment against fake modules and file system, returning every call they saw, in order. */
function deployWith(input: {
  readonly environment: string;
  readonly context: PipelineContext;
  readonly servedUrl: string;
  readonly packageJson?: PackageJson;
  readonly existingBuild?: Option.Option<NativeBuild>;
  readonly fingerprints?: ReadonlyArray<string>;
  readonly appleTeamId?: Option.Option<string>;
}): Effect.Effect<ReadonlyArray<Call>, string> {
  const calls: Array<Call> = [];
  const record = (method: string, request: unknown) => { calls.push({ method, input: request }); };
  const eas = EasImpl.mockLayer({
    *deployWeb(request): EffectGen<WebDeployment, string> {
      record("deployWeb", request);
      return { identifier: request.id, url: input.servedUrl };
    },
    *findBuild(request): EffectGen<Option.Option<NativeBuild>, string> {
      record("findBuild", request);
      return input.existingBuild ?? Option.none();
    },
    *startBuild(request: { readonly platform: NativePlatform; readonly profile: string; readonly message: string }): EffectGen<NativeBuild, string> {
      record("startBuild", request);
      return { id: "new-build", status: "NEW" };
    },
    *publishUpdate(request): EffectGen<void, string> {
      record("publishUpdate", request);
    },
  });
  const credentials = SigningCredentialsImpl.mockLayer({
    *androidFingerprints(request): EffectGen<ReadonlyArray<string>, string> {
      record("androidFingerprints", request);
      return input.fingerprints ?? [FINGERPRINT];
    },
    *appleTeamId(request): EffectGen<Option.Option<string>, string> {
      record("appleTeamId", request);
      return input.appleTeamId ?? Option.some("ABCDE12345");
    },
  });
  const customDomains = CustomDomainsImpl.mockLayer({
    *ensure(request): EffectGen<{ readonly change: Change; readonly domain: CustomDomain }, string> {
      record("ensureCustomDomain", request);
      return { change: CustomDomainChange.Registered(), domain: registeredDomain };
    },
  });
  const fileSystem = FileSystem.layerNoop({
    makeDirectory: () => Effect.void,
    writeFileString: (path, content) => Effect.sync(() => record("writeFile", { path, content: JSON.parse(content) })),
  });
  const pkg = PackageImpl.mockLayer({ *load(): EffectGen<PackageJson, string> { return input.packageJson ?? packageJson({ domain: null }); } });
  const expo = ExpoImpl.mockLayer({ *readAppConfig(): EffectGen<AppConfig, string> { return appConfig; } });
  return pipe(
    effunct(function* (): EffectGen<void, string, AppExpoModules.Deployer> {
      yield* (yield* appExpoModules.Deployer).deploy({ environment: input.environment, context: input.context });
    })(),
    Effect.map(() => calls),
    Effect.provide(pipe(DeployerImpl.Layer, Layer.provide(Layer.mergeAll(eas, credentials, customDomains, fileSystem, pkg, expo)))),
  );
}

const methods = (calls: ReadonlyArray<Call>) => calls.map(({ method }) => method);

describe("deploy", () => {
  test("a branch environment starts the Android build it lacks, deploys its web export, then publishes an update to its channel", function* () {
    const calls = yield* deployWith({ environment: "Staging", context: commit, servedUrl: "https://my-app--staging.expo.app" });
    expect(methods(calls)).toEqual(["findBuild", "startBuild", "deployWeb", "publishUpdate"]);
    expect(calls[0]!.input).toEqual({ platform: "android", profile: "staging", runtimeVersion: "1.0.0" });
    expect(calls[2]!.input).toEqual({
      exportDir: "dist/web/Staging",
      subdomain: "my-app",
      id: "alias-staging-1a2b3c4d",
      promotion: Promotion.Alias({ alias: "staging" }),
      easEnvironment: "preview",
    });
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
    expect(methods(calls)).toEqual(["findBuild", "deployWeb", "publishUpdate"]);
  });

  test("a pull request deploys the web app only", function* () {
    const calls = yield* deployWith({ environment: "Preview", context: pullRequest, servedUrl: "https://my-app--pr-42-1a2b3c4d.expo.app" });
    expect(methods(calls)).toEqual(["deployWeb"]);
  });

  test("fails, before publishing any update, when EAS serves the web app somewhere deploy:plan did not announce", function* () {
    const result = yield* Effect.result(deployWith({ environment: "Staging", context: commit, servedUrl: "https://my-app--elsewhere.expo.app" }));
    expect(result._tag).toBe("Failure");
    expect(result._tag === "Failure" ? result.failure : "").toContain("deploy:plan announced https://my-app--staging.expo.app/");
  });

  test("refuses an environment the package does not deploy", function* () {
    const result = yield* Effect.result(deployWith({ environment: "Elsewhere", context: commit, servedUrl: "" }));
    expect(result._tag).toBe("Failure");
  });
});

describe("deploy with a custom domain", () => {
  const withDomain = (platforms: ReadonlyArray<NativePlatform> = ["android"]) => packageJson({ domain: "app.example.com" }, platforms);

  test("production writes assetlinks.json from the keystore the build created, deploys, registers the domain, then updates", function* () {
    const calls = yield* deployWith({ environment: "Production", context: commit, servedUrl: "https://my-app.expo.app", packageJson: withDomain() });
    expect(methods(calls)).toEqual(["findBuild", "startBuild", "androidFingerprints", "writeFile", "deployWeb", "ensureCustomDomain", "publishUpdate"]);
    expect(calls[2]!.input).toEqual({ projectId: "00000000-0000-0000-0000-000000000000", packageName: "sh.jive.myapp" });
    expect(calls[3]!.input).toEqual({
      path: "dist/web/Production/.well-known/assetlinks.json",
      content: [{
        relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
        target: { namespace: "android_app", package_name: "sh.jive.myapp", sha256_cert_fingerprints: [FINGERPRINT] },
      }],
    });
    expect(calls[5]!.input).toEqual({ projectId: "00000000-0000-0000-0000-000000000000", hostname: "app.example.com" });
  });

  test("an iOS app gets apple-app-site-association naming its team and bundle identifier", function* () {
    const calls = yield* deployWith({ environment: "Production", context: commit, servedUrl: "https://my-app.expo.app", packageJson: withDomain(["ios"]) });
    const written = calls.find(({ method }) => method === "writeFile")!.input;
    expect(written).toEqual({
      path: "dist/web/Production/.well-known/apple-app-site-association",
      content: { applinks: { apps: [], details: [{ appID: "ABCDE12345.sh.jive.myapp", paths: ["*"] }] } },
    });
  });

  test("an aliased environment and a preview get the association files but leave the domain alone", function* () {
    const staging = yield* deployWith({ environment: "Staging", context: commit, servedUrl: "https://my-app--staging.expo.app", packageJson: withDomain() });
    expect(methods(staging)).toEqual(["findBuild", "startBuild", "androidFingerprints", "writeFile", "deployWeb", "publishUpdate"]);
    const preview = yield* deployWith({ environment: "Preview", context: pullRequest, servedUrl: "https://my-app--pr-42-1a2b3c4d.expo.app", packageJson: withDomain() });
    expect(methods(preview)).toEqual(["androidFingerprints", "writeFile", "deployWeb"]);
  });

  test("a file whose signing identity EAS does not hold yet is left out, and the deploy carries on", function* () {
    const calls = yield* deployWith({
      environment: "Production",
      context: commit,
      servedUrl: "https://my-app.expo.app",
      packageJson: withDomain(["android", "ios"]),
      fingerprints: [],
      appleTeamId: Option.none(),
    });
    expect(methods(calls)).not.toContain("writeFile");
    expect(methods(calls)).toContain("ensureCustomDomain");
  });

  test("a web-only app registers the domain without reading any signing credentials", function* () {
    const calls = yield* deployWith({ environment: "Production", context: commit, servedUrl: "https://my-app.expo.app", packageJson: withDomain([]) });
    expect(methods(calls)).toEqual(["deployWeb", "ensureCustomDomain"]);
  });

  test("with domain null, nothing reads credentials, writes files or touches the domain", function* () {
    const calls = yield* deployWith({ environment: "Production", context: commit, servedUrl: "https://my-app.expo.app" });
    expect(methods(calls).filter((method) => ["androidFingerprints", "appleTeamId", "writeFile", "ensureCustomDomain"].includes(method))).toEqual([]);
  });
});
