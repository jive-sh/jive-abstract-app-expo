import { Schema } from "effect";
import { makeJivePackageJsonSchema, type CicdConfig } from "jive-abstract-library";
import { CHANNEL_PATTERN, nativeChannel } from "../native/eas-json";

/**
 * The shape a package.json must have to be built and deployed by this abstract: everything every Jive
 * package has, plus the `app-expo` block beside `cicd` under `jive`. The dev server renders it to
 * `package.schema.json` for the editor, and every hook decodes against it.
 */

/** The environment Jive's pipeline deploys for a pull request, when `cicd.deploy.previews` is on. */
export const PREVIEW_ENVIRONMENT = "Preview";

/** The secret an app extending this abstract must give its pipeline: an Expo access token for its EAS project. */
export const EXPO_TOKEN_SECRET = "EXPO_TOKEN";

/** The key this abstract's block has under `jive`, and the `<kind>` in `jive-abstract-<kind>`. */
export const ABSTRACT_KEY = "app-expo";

/**
 * A lowercase DNS label, the form EAS Hosting accepts for preview subdomains and aliases. eas-cli lowercases
 * what it is given and rejects anything else, so the schema asks for the final form rather than letting the
 * URL this abstract predicts differ from the one EAS assigns.
 */
const DnsLabel = Schema.NonEmptyString.check(Schema.isPattern(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/));

const EasEnvironment = Schema.Literals(["production", "preview", "development"]).annotate({
  description: 'The EAS environment whose server-side variables EAS applies to this environment\'s deploys, builds and updates (https://docs.expo.dev/eas/environment-variables/). eas.json accepts only these three.',
});

const PUBLIC_VARIABLE_NAME = /^EXPO_PUBLIC_[A-Z0-9_]+$/;

/**
 * A record whose key schema has a pattern skips non-matching keys instead of rejecting them, so the names
 * are checked here; the JSON Schema gets the same rule as `propertyNames` for the editor.
 */
const Variables = Schema.Record(Schema.String, Schema.String)
  .check(Schema.makeFilter(
    (variables: Readonly<Record<string, string>>) => {
      const rejected = Object.keys(variables).filter((name) => !PUBLIC_VARIABLE_NAME.test(name));
      return rejected.length === 0
        ? undefined
        : `${rejected.map((name) => `"${name}"`).join(", ")}: only EXPO_PUBLIC_ variables are inlined into the app`;
    },
    { toJsonSchema: () => ({ propertyNames: { pattern: PUBLIC_VARIABLE_NAME.source } }) },
  ))
  .annotate({
    description: 'Variables Expo inlines into the app bundle for this environment, e.g. {"EXPO_PUBLIC_SERVER_URL": "https://api.example.com"}. Only EXPO_PUBLIC_ names are inlined, so others are rejected rather than silently dropped. They are readable by anyone who loads the app; never put a secret here.',
  });

/**
 * Where an environment's web build is served. Every EAS Hosting deployment is immutable and reachable at its
 * own URL; an alias is a name that points at the newest one, and production is the one alias served at the
 * project's own subdomain and custom domain.
 */
const WebTarget = Schema.Union([
  Schema.Literal("production").annotate({
    description: "Promote this environment's deployment to production, served at https://<subdomain>.expo.app and the custom domain.",
  }),
  Schema.Struct({
    alias: DnsLabel.annotate({ description: 'Alias served at https://<subdomain>--<alias>.expo.app, e.g. "staging".' }),
  }),
]);

const EnvironmentSchema = Schema.Struct({
  web: WebTarget,
  easEnvironment: EasEnvironment,
  variables: Variables,
});
export type EnvironmentConfig = Schema.Schema.Type<typeof EnvironmentSchema>;

const PreviewSchema = Schema.Struct({
  easEnvironment: EasEnvironment,
  variables: Variables,
});
export type PreviewConfig = Schema.Schema.Type<typeof PreviewSchema>;

export const NativePlatform = Schema.Literals(["android", "ios"]);
export type NativePlatform = Schema.Schema.Type<typeof NativePlatform>;

const NativeSchema = Schema.Struct({
  platforms: Schema.Array(NativePlatform).annotate({
    description: 'Native apps to build and update for every environment, e.g. ["android"]. [] deploys the web app only. iOS needs an Apple Developer Program membership linked to the EAS project.',
  }),
  distribution: Schema.Literals(["internal", "store"]).annotate({
    description: '"internal" builds installable straight from an EAS link (an APK on Android; ad hoc on iOS, limited to registered devices). "store" builds for Google Play and the App Store, which submitting to needs those accounts.',
  }),
});
export type NativeConfig = Schema.Schema.Type<typeof NativeSchema>;

/** Everything this abstract owns in an extending package's manifest. */
export const AppExpoSchema = Schema.Struct({
  web: Schema.Struct({
    subdomain: DnsLabel.check(Schema.isMinLength(3)).annotate({
      description: 'The EAS Hosting preview subdomain name: production is served at https://<subdomain>.expo.app. EAS reserves it on the first deploy and it can never be reused, even after the project is deleted.',
    }),
    customDomain: Schema.OptionFromNullOr(Schema.NonEmptyString).annotate({
      description: 'The domain production is served at once it is assigned in the project\'s EAS Hosting settings (a paid-plan feature), e.g. "example.com", or null. Only the deploy URL depends on it; assigning it and its DNS records is done outside this abstract.',
    }),
  }),
  native: NativeSchema,
  environments: Schema.Record(Schema.String, EnvironmentSchema).annotate({
    description: 'One entry for every environment named in cicd.deploy.branches, keyed by that name, e.g. {"Production": {...}}.',
  }),
  preview: Schema.OptionFromNullOr(PreviewSchema).annotate({
    description: 'Configuration for the "Preview" environment a pull request deploys. Required when cicd.deploy.previews is true and null when it is false.',
  }),
});
export type AppExpoConfig = Schema.Schema.Type<typeof AppExpoSchema>;

/**
 * Rules that span `cicd` and `app-expo`, which no field-level check can see. Returned as a message per broken
 * rule so a manifest that breaks several is fixed in one pass.
 */
export function crossFieldErrors(cicd: CicdConfig, appExpo: AppExpoConfig): ReadonlyArray<string> {
  const errors: Array<string> = [];
  const deployed = new Set(Object.values(cicd.deploy.branches).flat());
  const configured = new Set(Object.keys(appExpo.environments));

  for (const name of deployed) {
    if (!configured.has(name)) errors.push(`cicd.deploy.branches deploys "${name}", which has no entry in jive.${ABSTRACT_KEY}.environments`);
  }
  for (const name of configured) {
    if (!deployed.has(name)) errors.push(`jive.${ABSTRACT_KEY}.environments has "${name}", which no branch in cicd.deploy.branches deploys`);
  }
  if (!(cicd.requiredSecrets ?? []).includes(EXPO_TOKEN_SECRET)) {
    errors.push(`cicd.requiredSecrets must include "${EXPO_TOKEN_SECRET}": every deploy runs EAS CLI, which authenticates with that access token (https://docs.expo.dev/accounts/programmatic-access/), and the pipeline only passes listed secrets to the hooks`);
  }
  if (configured.has(PREVIEW_ENVIRONMENT)) {
    errors.push(`"${PREVIEW_ENVIRONMENT}" is the pull request environment; configure it under jive.${ABSTRACT_KEY}.preview`);
  }
  if (cicd.deploy.previews && appExpo.preview._tag === "None") {
    errors.push(`cicd.deploy.previews is true, so jive.${ABSTRACT_KEY}.preview must be set`);
  }
  if (!cicd.deploy.previews && appExpo.preview._tag === "Some") {
    errors.push(`cicd.deploy.previews is false, so jive.${ABSTRACT_KEY}.preview must be null`);
  }

  if (appExpo.native.platforms.length > 0) {
    const byChannel = new Map<string, Array<string>>();
    for (const name of configured) {
      const channel = nativeChannel(name);
      if (!CHANNEL_PATTERN.test(channel)) errors.push(`"${name}" cannot name an EAS Update channel: in lowercase it must match ${CHANNEL_PATTERN.source}`);
      byChannel.set(channel, [...(byChannel.get(channel) ?? []), name]);
    }
    for (const [channel, names] of byChannel) {
      if (names.length > 1) errors.push(`${names.map((name) => `"${name}"`).join(", ")} would share the EAS Update channel "${channel}"`);
    }
  }

  const targets = Object.entries(appExpo.environments).map(([name, { web }]) => ({ name, web }));
  const production = targets.filter(({ web }) => web === "production").map(({ name }) => name);
  if (production.length > 1) {
    errors.push(`Only one environment can be served as production; ${production.map((name) => `"${name}"`).join(", ")} all are`);
  }
  const byAlias = new Map<string, Array<string>>();
  for (const { name, web } of targets) {
    if (web !== "production") byAlias.set(web.alias, [...(byAlias.get(web.alias) ?? []), name]);
  }
  for (const [alias, names] of byAlias) {
    if (names.length > 1) errors.push(`Alias "${alias}" is used by ${names.map((name) => `"${name}"`).join(", ")}; each environment needs its own`);
  }
  return errors;
}

export const PackageJsonSchema = makeJivePackageJsonSchema({ [ABSTRACT_KEY]: AppExpoSchema });
export type PackageJson = Schema.Schema.Type<typeof PackageJsonSchema>;

/** The `jive` block, which `jive:cicd:get-config` prints. */
export const JivePackageConfig = PackageJsonSchema.fields.jive;
