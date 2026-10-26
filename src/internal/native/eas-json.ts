import type { AppExpoConfig } from "../public/manifest";

/** The eas-cli release the generated eas.json asks for, matching this package's eas-cli peer range. */
export const EAS_CLI_VERSION_RANGE = ">= 25.3.0";

/**
 * eas.json, derived from package.json so the environments live in one place. EAS Build reads its build
 * profiles from this file (https://docs.expo.dev/build/eas-json/), so each Jive environment becomes the
 * profile of the same name, whose builds listen on the EAS Update channel of the same name
 * (https://docs.expo.dev/eas-update/deployment/#channel-configuration) and are built with that
 * environment's variables. The pull request environment gets no profile: previews deploy the web app only.
 *
 * Build numbers are kept by EAS and raised on every build (`appVersionSource: remote`), since a source file
 * the pipeline edited would not survive into the next run.
 */
export function renderEasJson(config: AppExpoConfig): string {
  const build = Object.fromEntries(Object.entries(config.environments).map(([name, environment]) => [name, {
    channel: name,
    distribution: config.native.distribution,
    environment: environment.easEnvironment,
    env: environment.variables,
    autoIncrement: true,
    ...(config.native.distribution === "internal" ? { android: { buildType: "apk" } } : {}),
  }]));
  return `${JSON.stringify({ cli: { version: EAS_CLI_VERSION_RANGE, appVersionSource: "remote" }, build }, null, 2)}\n`;
}
