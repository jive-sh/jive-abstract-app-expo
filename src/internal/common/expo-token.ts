import { Effect } from "effect";
import type { EffectGen } from "effective-modules";
import { EXPO_TOKEN_SECRET } from "../public/manifest";

/**
 * The Expo access token every call to EAS authenticates with, both through EAS CLI and Expo's API
 * (https://docs.expo.dev/accounts/programmatic-access/). The pipeline sets it from the repository secret.
 */
export function* readExpoToken(): EffectGen<string, string> {
  const token = process.env[EXPO_TOKEN_SECRET];
  if (token === undefined || token === "") {
    return yield* Effect.fail(`${EXPO_TOKEN_SECRET} is not set. EAS authenticates CI with an access token (https://docs.expo.dev/accounts/programmatic-access/); add it to the repository's secrets and to jive.cicd.requiredSecrets`);
  }
  return token;
}
