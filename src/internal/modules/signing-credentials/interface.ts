import type { Option } from "effect";
import type { EffectGen } from "effective-modules";

/**
 * The signing identities EAS Build signs a project's apps with, read from the EAS credentials service through
 * Expo's API (the queries `eas credentials` runs). Read-only: it never selects keystore files or passwords.
 */
export interface ISigningCredentials {
  /**
   * SHA-256 certificate fingerprints of every keystore EAS holds for the Android package, as `AA:BB:…`, which
   * the domain's assetlinks.json must list. Empty until the package's first EAS Build generates a keystore.
   */
  androidFingerprints(input: { readonly projectId: string; readonly packageName: string }): EffectGen<ReadonlyArray<string>, string>;
  /**
   * The Apple Developer team ID the iOS app with this bundle identifier is signed under, which prefixes its app
   * ID in apple-app-site-association. None until iOS credentials are set up for it.
   */
  appleTeamId(input: { readonly projectId: string; readonly bundleIdentifier: string }): EffectGen<Option.Option<string>, string>;
}
