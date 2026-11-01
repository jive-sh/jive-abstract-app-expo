import { Effect, FileSystem, Option, Schema, SchemaIssue, pipe } from "effect";
import { implementing, type EffectGen } from "effective-modules";
import { resolve } from "node:path";
import { DYNAMIC_APP_CONFIG_FILES, GENERATED_APP_CONFIG_FILE, GENERATED_APP_CONFIG_MARKER } from "../../linking/app-config";
import { appExpoModules } from "../index";
import type { AppConfig, IExpo } from "./interface";

const formatSchemaError = SchemaIssue.makeFormatterDefault();

const RuntimeVersion = Schema.Union([
  Schema.NonEmptyString,
  Schema.Struct({ policy: Schema.NonEmptyString }),
]);

const ExpoConfigJson = Schema.Struct({
  slug: Schema.NonEmptyString,
  version: Schema.NonEmptyString,
  owner: Schema.OptionFromOptionalKey(Schema.NonEmptyString),
  runtimeVersion: Schema.OptionFromOptionalKey(RuntimeVersion),
  extra: Schema.OptionFromOptionalKey(Schema.Struct({
    eas: Schema.OptionFromOptionalKey(Schema.Struct({
      projectId: Schema.OptionFromOptionalKey(Schema.NonEmptyString),
    })),
  })),
  updates: Schema.OptionFromOptionalKey(Schema.Struct({ url: Schema.OptionFromOptionalKey(Schema.NonEmptyString) })),
  android: Schema.OptionFromOptionalKey(Schema.Struct({ package: Schema.OptionFromOptionalKey(Schema.NonEmptyString) })),
  ios: Schema.OptionFromOptionalKey(Schema.Struct({ bundleIdentifier: Schema.OptionFromOptionalKey(Schema.NonEmptyString) })),
});

export class ExpoImpl extends implementing(appExpoModules.Expo).uses(appExpoModules.Process, FileSystem.FileSystem) implements IExpo {
  *readAppConfig(): EffectGen<AppConfig, string> {
    const stdout = yield* this.dependencies.Process.output({
      command: yield* this.expoBinary(),
      args: ["config", "--json", "--type", "public"],
      cwd: process.cwd(),
      env: {},
    });
    const json = yield* Effect.try({
      try: () => JSON.parse(stdout) as unknown,
      catch: (e) => `expo config printed something other than JSON: ${(e as Error).message}`,
    });
    const config = yield* pipe(
      Schema.decodeUnknownEffect(ExpoConfigJson, { onExcessProperty: "ignore" })(json),
      Effect.catchTag("SchemaError", (e) => Effect.fail(`The app's Expo config is not usable:\n${formatSchemaError(e.issue)}`)),
    );

    const runtimeVersion = yield* Option.match(config.runtimeVersion, {
      onNone: () => Effect.succeed(Option.none<string>()),
      onSome: (value) => typeof value === "string"
        ? Effect.succeed(Option.some(value))
        : value.policy === "appVersion"
          ? Effect.succeed(Option.some(config.version))
          : Effect.fail(`expo.runtimeVersion's "${value.policy}" policy is not supported; use "appVersion" or a literal version, which this abstract can resolve without building`),
    });

    return {
      slug: config.slug,
      version: config.version,
      owner: config.owner,
      projectId: pipe(config.extra, Option.flatMap((extra) => extra.eas), Option.flatMap((eas) => eas.projectId)),
      runtimeVersion,
      updatesUrl: pipe(config.updates, Option.flatMap((updates) => updates.url)),
      androidPackage: pipe(config.android, Option.flatMap((android) => android.package)),
      iosBundleIdentifier: pipe(config.ios, Option.flatMap((ios) => ios.bundleIdentifier)),
    };
  }

  *exportWeb(input: { readonly outputDir: string; readonly variables: Readonly<Record<string, string>> }): EffectGen<void, string> {
    yield* this.dependencies.Process.run({
      command: yield* this.expoBinary(),
      args: ["export", "--platform", "web", "--output-dir", input.outputDir],
      cwd: process.cwd(),
      env: input.variables,
    });
  }

  *writeGeneratedConfig(source: Option.Option<string>): EffectGen<void, string> {
    const fs = this.getDependency(FileSystem.FileSystem);
    const generatedPath = resolve(process.cwd(), GENERATED_APP_CONFIG_FILE);
    const isGenerated = (path: string) => pipe(
      fs.readFileString(path),
      Effect.map((text) => text.startsWith(GENERATED_APP_CONFIG_MARKER)),
      Effect.mapError((e) => `Cannot read ${path}: ${e.message}`),
    );

    const ownConfigs: Array<string> = [];
    for (const file of DYNAMIC_APP_CONFIG_FILES) {
      const path = resolve(process.cwd(), file);
      const exists = yield* pipe(fs.exists(path), Effect.mapError((e) => `Cannot check for ${path}: ${e.message}`));
      if (exists && !(path === generatedPath && (yield* isGenerated(path)))) ownConfigs.push(file);
    }

    if (Option.isNone(source)) {
      const stale = yield* pipe(fs.exists(generatedPath), Effect.mapError((e) => `Cannot check for ${generatedPath}: ${e.message}`));
      if (stale && !ownConfigs.includes(GENERATED_APP_CONFIG_FILE)) {
        yield* pipe(fs.remove(generatedPath), Effect.mapError((e) => `Cannot remove ${generatedPath}: ${e.message}`));
      }
      return;
    }
    if (ownConfigs.length > 0) {
      return yield* Effect.fail(`The app has its own ${ownConfigs.join(", ")}, but this abstract configures universal links by generating ${GENERATED_APP_CONFIG_FILE}, and Expo reads only one dynamic config (https://docs.expo.dev/workflow/configuration/). Move its settings into app.json.`);
    }
    yield* pipe(fs.writeFileString(generatedPath, source.value), Effect.mapError((e) => `Cannot write ${generatedPath}: ${e.message}`));
  }

  /** The app's own Expo CLI: the version its `expo` dependency pins, as Expo requires. */
  private *expoBinary(): EffectGen<string, string> {
    const path = resolve(process.cwd(), "node_modules", ".bin", "expo");
    const exists = yield* pipe(
      this.getDependency(FileSystem.FileSystem).exists(path),
      Effect.mapError((e) => `Cannot check for ${path}: ${e.message}`),
    );
    if (!exists) return yield* Effect.fail(`${path} does not exist; the app must depend on "expo" and have its dependencies installed`);
    return path;
  }
}
