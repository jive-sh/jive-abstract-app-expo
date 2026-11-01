import { Effect, Option, Schema, pipe } from "effect";
import { implementing, type EffectGen } from "effective-modules";
import { appExpoModules } from "../index";
import type { ISigningCredentials } from "./interface";

/** The selections of eas-cli 25.3.0's `AndroidAppCredentialsQuery` and `IosAppCredentialsQuery` this needs. */
const ANDROID = `query JiveAppExpoAndroidSigning($appId: String!, $packageName: String!) {
  app { byId(appId: $appId) { id androidAppCredentials(filter: { applicationIdentifier: $packageName }) {
    androidAppBuildCredentialsList { androidKeystore { sha256CertificateFingerprint } }
  } } }
}`;

const IOS = `query JiveAppExpoIosSigning($appId: String!) {
  app { byId(appId: $appId) { id iosAppCredentials {
    appleTeam { appleTeamIdentifier }
    appleAppIdentifier { bundleIdentifier appleTeam { appleTeamIdentifier } }
  } } }
}`;

const AppleTeam = Schema.OptionFromNullOr(Schema.Struct({ appleTeamIdentifier: Schema.NonEmptyString }));

/** `AA:BB:…:FF`, the form assetlinks.json requires, from however EAS spells the 32 bytes. */
export function formatSha256Fingerprint(raw: string): Option.Option<string> {
  const hex = raw.replace(/[\s:]/g, "").toUpperCase();
  return /^[0-9A-F]{64}$/.test(hex) ? Option.some(hex.match(/../g)!.join(":")) : Option.none();
}

export class SigningCredentialsImpl extends implementing(appExpoModules.SigningCredentials).uses(appExpoModules.ExpoApi) implements ISigningCredentials {
  *androidFingerprints({ projectId, packageName }: { readonly projectId: string; readonly packageName: string }): EffectGen<ReadonlyArray<string>, string> {
    const data = yield* pipe(
      this.query({
        operationName: "JiveAppExpoAndroidSigning",
        document: ANDROID,
        variables: { appId: projectId, packageName },
        data: Schema.Struct({ app: Schema.Struct({ byId: Schema.Struct({ androidAppCredentials: Schema.Array(Schema.Struct({
          androidAppBuildCredentialsList: Schema.Array(Schema.Struct({
            androidKeystore: Schema.OptionFromNullOr(Schema.Struct({ sha256CertificateFingerprint: Schema.OptionFromNullOr(Schema.String) })),
          })),
        })) }) }) }),
      }),
      Effect.mapError((reason) => `Cannot read the Android signing credentials of ${packageName}: ${reason}`),
    );
    const raw = data.app.byId.androidAppCredentials
      .flatMap(({ androidAppBuildCredentialsList }) => androidAppBuildCredentialsList)
      .flatMap(({ androidKeystore }) => Option.toArray(Option.flatMap(androidKeystore, ({ sha256CertificateFingerprint }) => sha256CertificateFingerprint)));
    const fingerprints: Array<string> = [];
    for (const value of raw) {
      const formatted = formatSha256Fingerprint(value);
      if (Option.isNone(formatted)) return yield* Effect.fail(`EAS reported "${value}" as a keystore's SHA-256 fingerprint for ${packageName}, which is not 32 bytes of hex`);
      if (!fingerprints.includes(formatted.value)) fingerprints.push(formatted.value);
    }
    return fingerprints;
  }

  *appleTeamId({ projectId, bundleIdentifier }: { readonly projectId: string; readonly bundleIdentifier: string }): EffectGen<Option.Option<string>, string> {
    const data = yield* pipe(
      this.query({
        operationName: "JiveAppExpoIosSigning",
        document: IOS,
        variables: { appId: projectId },
        data: Schema.Struct({ app: Schema.Struct({ byId: Schema.Struct({ iosAppCredentials: Schema.Array(Schema.Struct({
          appleTeam: AppleTeam,
          appleAppIdentifier: Schema.Struct({ bundleIdentifier: Schema.String, appleTeam: AppleTeam }),
        })) }) }) }),
      }),
      Effect.mapError((reason) => `Cannot read the iOS signing credentials of ${bundleIdentifier}: ${reason}`),
    );
    const credentials = data.app.byId.iosAppCredentials.find(({ appleAppIdentifier }) => appleAppIdentifier.bundleIdentifier === bundleIdentifier);
    if (credentials === undefined) return Option.none();
    return pipe(
      credentials.appleTeam,
      Option.orElse(() => credentials.appleAppIdentifier.appleTeam),
      Option.map(({ appleTeamIdentifier }) => appleTeamIdentifier),
    );
  }

  private query<S extends Schema.Top & { readonly DecodingServices: never }>(input: {
    readonly operationName: string;
    readonly document: string;
    readonly variables: Readonly<Record<string, unknown>>;
    readonly data: S;
  }): Effect.Effect<S["Type"], string> {
    const api = this.dependencies.ExpoApi;
    return pipe(
      Effect.gen(function* () { return yield* api.graphql(input); }),
      Effect.mapError((e) => e.description),
    );
  }
}
