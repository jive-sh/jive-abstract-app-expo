import type { Option } from "effect";
import type { EffectGen } from "effective-modules";
import type { Promotion } from "../../hosting/web-target";
import type { NativePlatform } from "../../public/manifest";

export interface WebDeployment {
  readonly identifier: string;
  /** The URL the promotion makes it reachable at: the production or alias URL, else its own. */
  readonly url: string;
}

export interface NativeBuild {
  readonly id: string;
  readonly status: string;
}

/**
 * EAS, driven through EAS CLI. Every command authenticates with `EXPO_TOKEN`
 * (https://docs.expo.dev/accounts/programmatic-access/#access-tokens-usage), which only this module reads.
 */
export interface IEas {
  /** Uploads an exported web app to EAS Hosting as deployment `id` and promotes it as `promotion` says. */
  deployWeb(input: {
    readonly exportDir: string;
    readonly subdomain: string;
    readonly id: string;
    readonly promotion: Promotion;
    readonly easEnvironment: string;
  }): EffectGen<WebDeployment, string>;
  /** Writes the eas.json EAS Build reads its profiles from. */
  writeConfig(easJson: string): EffectGen<void, string>;
  /**
   * The newest build of `profile` for `platform` and `runtimeVersion` that has finished or is still on its
   * way, so a deploy starts a binary build only when no usable one exists for that runtime.
   */
  findBuild(input: {
    readonly platform: NativePlatform;
    readonly profile: string;
    readonly runtimeVersion: string;
  }): EffectGen<Option.Option<NativeBuild>, string>;
  /** Queues a binary build on EAS and returns without waiting for it. */
  startBuild(input: {
    readonly platform: NativePlatform;
    readonly profile: string;
    readonly message: string;
  }): EffectGen<NativeBuild, string>;
  /** Bundles the app with `variables` inlined and publishes it as an update on `channel`. */
  publishUpdate(input: {
    readonly platform: NativePlatform;
    readonly channel: string;
    readonly easEnvironment: string;
    readonly message: string;
    readonly variables: Readonly<Record<string, string>>;
  }): EffectGen<void, string>;
}
