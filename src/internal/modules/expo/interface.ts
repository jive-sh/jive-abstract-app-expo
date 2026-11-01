import type { Option } from "effect";
import type { EffectGen } from "effective-modules";

/** The parts of an app's Expo config (app.json or app.config.*) the hooks act on, as Expo resolves them. */
export interface AppConfig {
  readonly slug: string;
  readonly version: string;
  /** The Expo account that owns the EAS project (`expo.owner`). */
  readonly owner: Option.Option<string>;
  /** The linked EAS project (`expo.extra.eas.projectId`), which `eas init` writes. */
  readonly projectId: Option.Option<string>;
  /**
   * The runtime version native builds and updates are matched on, resolved from `expo.runtimeVersion`: a
   * literal, or the app version under the `appVersion` policy. None when the app sets neither.
   */
  readonly runtimeVersion: Option.Option<string>;
  /** Where the app downloads updates from (`expo.updates.url`). */
  readonly updatesUrl: Option.Option<string>;
  readonly androidPackage: Option.Option<string>;
  readonly iosBundleIdentifier: Option.Option<string>;
}

export interface IExpo {
  /** Reads the app's Expo config through Expo CLI, so app.config.* files are evaluated the way Expo does. */
  readAppConfig(): EffectGen<AppConfig, string>;
  /**
   * Exports the web app into `outputDir` with `variables` inlined, which is how one environment's build gets
   * its own values: Expo replaces each `process.env.EXPO_PUBLIC_*` reference at export time
   * (https://docs.expo.dev/guides/environment-variables/).
   */
  exportWeb(input: { readonly outputDir: string; readonly variables: Readonly<Record<string, string>> }): EffectGen<void, string>;
  /**
   * Writes the dynamic config Expo evaluates over the app's app.json, or with None removes the one an earlier
   * build wrote. Fails when the app has a dynamic config of its own, since Expo reads only one.
   */
  writeGeneratedConfig(source: Option.Option<string>): EffectGen<void, string>;
}
