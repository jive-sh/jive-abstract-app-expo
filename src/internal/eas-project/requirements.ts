import { Option } from "effect";
import type { AppConfig } from "../modules/expo/interface";
import type { AppExpoConfig } from "../public/manifest";

const LINK_HINT = "Link the app to an EAS project once with `eas init --account <account>`, which writes both (https://docs.expo.dev/accounts/programmatic-access/#access-tokens-usage)";

/**
 * Checks the app's Expo config against what deploying needs, so a pull request build fails on a missing
 * setting rather than the deploy after merge. Returns one message per problem.
 */
export function appConfigErrors(appConfig: AppConfig, config: AppExpoConfig): ReadonlyArray<string> {
  const errors: Array<string> = [];
  if (Option.isNone(appConfig.owner)) errors.push(`expo.owner is not set. ${LINK_HINT}`);
  if (Option.isNone(appConfig.projectId)) errors.push(`expo.extra.eas.projectId is not set. ${LINK_HINT}`);

  const platforms = config.native.platforms;
  if (platforms.length === 0) return errors;

  if (Option.isNone(appConfig.runtimeVersion)) {
    errors.push('expo.runtimeVersion is not set; set it to {"policy": "appVersion"} so updates reach only builds they are compatible with (https://docs.expo.dev/eas-update/runtime-versions/)');
  }
  if (Option.isSome(appConfig.projectId)) {
    const expected = `https://u.expo.dev/${appConfig.projectId.value}`;
    if (!Option.contains(appConfig.updatesUrl, expected)) {
      errors.push(`expo.updates.url must be "${expected}" so builds download updates from this project (https://docs.expo.dev/eas-update/getting-started/)`);
    }
  }
  if (platforms.includes("android") && Option.isNone(appConfig.androidPackage)) {
    errors.push('expo.android.package is not set; EAS Build cannot ask for it in a pipeline');
  }
  if (platforms.includes("ios") && Option.isNone(appConfig.iosBundleIdentifier)) {
    errors.push('expo.ios.bundleIdentifier is not set; EAS Build cannot ask for it in a pipeline');
  }
  return errors;
}
