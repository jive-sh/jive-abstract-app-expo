import { Effect, FileSystem, Option, Schema, SchemaIssue, pipe } from "effect";
import { implementing, type EffectGen } from "effective-modules";
import { resolve } from "node:path";
import { Promotion } from "../../hosting/web-target";
import type { NativePlatform } from "../../public/manifest";
import { appExpoModules } from "../index";
import type { IEas, NativeBuild, WebDeployment } from "./interface";

const TOKEN_VARIABLE = "EXPO_TOKEN";
const EAS_JSON_FILE = "eas.json";

/** Statuses of a build that is, or will become, installable; anything else means a new one is needed. */
const USABLE_BUILD_STATUSES = new Set(["NEW", "IN_QUEUE", "IN_PROGRESS", "FINISHED"]);

const formatSchemaError = SchemaIssue.makeFormatterDefault();

/** `eas deploy --json`, from eas-cli's `formatWorkerDeploymentJson`. */
const DeployOutput = Schema.Struct({
  identifier: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
  aliases: Schema.OptionFromOptionalKey(Schema.Array(Schema.Struct({ url: Schema.NonEmptyString }))),
  production: Schema.OptionFromOptionalKey(Schema.Struct({ url: Schema.NonEmptyString })),
});

const Build = Schema.Struct({ id: Schema.NonEmptyString, status: Schema.NonEmptyString });
const Builds = Schema.Array(Build);

function decodeJson<S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  what: string,
  stdout: string,
): Effect.Effect<S["Type"], string> {
  return pipe(
    Effect.try({
      try: () => JSON.parse(stdout) as unknown,
      catch: (e) => `${what} printed something other than JSON: ${(e as Error).message}\n${stdout.trim()}`,
    }),
    Effect.flatMap((json) => Schema.decodeUnknownEffect(schema, { onExcessProperty: "ignore" })(json)),
    Effect.catchTag("SchemaError", (e) => Effect.fail(`${what} printed JSON of an unexpected shape:\n${formatSchemaError(e.issue)}`)),
  );
}

export class EasImpl extends implementing(appExpoModules.Eas).uses(appExpoModules.Process, FileSystem.FileSystem) implements IEas {
  *deployWeb(input: {
    readonly exportDir: string;
    readonly subdomain: string;
    readonly id: string;
    readonly promotion: Promotion;
    readonly easEnvironment: string;
  }): EffectGen<WebDeployment, string> {
    const promotionArgs = Promotion.$match(input.promotion, {
      Production: () => ["--prod"],
      Alias: ({ alias }) => ["--alias", alias],
      None: () => [],
    });
    const output = yield* decodeJson(DeployOutput, "eas deploy", yield* this.eas([
      "deploy",
      "--export-dir", input.exportDir,
      "--dev-domain", input.subdomain,
      "--environment", input.easEnvironment,
      "--id", input.id,
      ...promotionArgs,
      "--json", "--non-interactive",
    ]));
    const url = Promotion.$match(input.promotion, {
      Production: () => Option.map(output.production, ({ url }) => url),
      Alias: () => pipe(output.aliases, Option.flatMap((aliases) => Option.fromNullishOr(aliases[0])), Option.map(({ url }) => url)),
      None: () => Option.some(output.url),
    });
    if (Option.isNone(url)) return yield* Effect.fail(`eas deploy did not report the URL for its ${input.promotion._tag} promotion:\n${JSON.stringify(output)}`);
    return { identifier: output.identifier, url: url.value };
  }

  *writeConfig(easJson: string): EffectGen<void, string> {
    const path = resolve(process.cwd(), EAS_JSON_FILE);
    yield* pipe(
      this.getDependency(FileSystem.FileSystem).writeFileString(path, easJson),
      Effect.mapError((e) => `Cannot write ${path}: ${e.message}`),
    );
  }

  *findBuild(input: {
    readonly platform: NativePlatform;
    readonly profile: string;
    readonly runtimeVersion: string;
  }): EffectGen<Option.Option<NativeBuild>, string> {
    const builds = yield* decodeJson(Builds, "eas build:list", yield* this.eas([
      "build:list",
      "--platform", input.platform,
      "--build-profile", input.profile,
      "--runtime-version", input.runtimeVersion,
      "--limit", "10",
      "--json", "--non-interactive",
    ]));
    return Option.fromNullishOr(builds.find(({ status }) => USABLE_BUILD_STATUSES.has(status)));
  }

  *startBuild(input: {
    readonly platform: NativePlatform;
    readonly profile: string;
    readonly message: string;
  }): EffectGen<NativeBuild, string> {
    const builds = yield* decodeJson(Builds, "eas build", yield* this.eas([
      "build",
      "--platform", input.platform,
      "--profile", input.profile,
      "--message", input.message,
      "--no-wait",
      "--json", "--non-interactive",
    ]));
    const [build] = builds;
    if (build === undefined) return yield* Effect.fail("eas build reported no build");
    return build;
  }

  *publishUpdate(input: {
    readonly platform: NativePlatform;
    readonly channel: string;
    readonly easEnvironment: string;
    readonly message: string;
    readonly variables: Readonly<Record<string, string>>;
  }): EffectGen<void, string> {
    yield* this.eas([
      "update",
      "--platform", input.platform,
      "--channel", input.channel,
      "--environment", input.easEnvironment,
      "--message", input.message,
      "--json", "--non-interactive",
    ], input.variables);
  }

  /** Runs the package's own EAS CLI (the `eas-cli` peer dependency) and returns its stdout. */
  private *eas(args: ReadonlyArray<string>, env: Readonly<Record<string, string>> = {}): EffectGen<string, string> {
    const token = process.env[TOKEN_VARIABLE];
    if (token === undefined || token === "") {
      return yield* Effect.fail(`${TOKEN_VARIABLE} is not set. EAS CLI authenticates CI with an access token (https://docs.expo.dev/accounts/programmatic-access/); add it to the repository's secrets and to jive.cicd.requiredSecrets`);
    }
    const binary = resolve(process.cwd(), "node_modules", ".bin", "eas");
    const exists = yield* pipe(
      this.getDependency(FileSystem.FileSystem).exists(binary),
      Effect.mapError((e) => `Cannot check for ${binary}: ${e.message}`),
    );
    if (!exists) return yield* Effect.fail(`${binary} does not exist; the app must depend on "eas-cli" and have its dependencies installed`);
    return yield* this.dependencies.Process.output({ command: binary, args, cwd: process.cwd(), env });
  }
}
