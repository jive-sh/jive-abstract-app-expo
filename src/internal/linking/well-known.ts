/**
 * The files a domain serves so iOS and Android trust it to open the app: Apple's app site association and
 * Google's Digital Asset Links statement. Both live under `/.well-known/`, which `eas deploy` uploads like any
 * other folder of the export, serving the extensionless association file as `application/json`.
 */

export const APPLE_APP_SITE_ASSOCIATION_PATH = ".well-known/apple-app-site-association";
export const ASSET_LINKS_PATH = ".well-known/assetlinks.json";

/**
 * Every path opens the app: the web app and the native app are one Expo app with the same routes
 * (https://docs.expo.dev/linking/ios-universal-links/).
 */
export function renderAppleAppSiteAssociation(input: { readonly appleTeamId: string; readonly bundleIdentifier: string }): string {
  return `${JSON.stringify({
    applinks: {
      apps: [],
      details: [{ appID: `${input.appleTeamId}.${input.bundleIdentifier}`, paths: ["*"] }],
    },
  }, null, 2)}\n`;
}

/**
 * `handle_all_urls` opens the app from the domain's links (https://docs.expo.dev/linking/android-app-links/), and
 * `get_login_creds` lets the app use the domain's passkeys and saved passwords through Credential Manager
 * (https://developer.android.com/identity/credential-manager/prerequisites), since the app and the website are one
 * Expo app signing in to one account.
 */
export function renderAssetLinks(input: { readonly packageName: string; readonly sha256Fingerprints: ReadonlyArray<string> }): string {
  return `${JSON.stringify([{
    relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
    target: {
      namespace: "android_app",
      package_name: input.packageName,
      sha256_cert_fingerprints: input.sha256Fingerprints,
    },
  }], null, 2)}\n`;
}
