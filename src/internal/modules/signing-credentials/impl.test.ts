import { describe, expect, test as buntest } from "bun:test";
import { Effect, Layer, Option, Schema, pipe } from "effect";
import { effunct, type EffectGen } from "effective-modules";
import { ExpoApiImpl } from "../expo-api/impl";
import type { ExpoApiError } from "../expo-api/interface";
import { AppExpoModules, appExpoModules } from "../index";
import { SigningCredentialsImpl, formatSha256Fingerprint } from "./impl";

/**
 * SigningCredentialsImpl against a fake Expo API answering in the shape of eas-cli 25.3.0's generated GraphQL
 * types (`AndroidAppCredentials`, `IosAppCredentials`).
 */

function test(name: string, body: () => EffectGen<void, any, never>) {
  buntest(name, async () => { await Effect.runPromise(effunct(body)()); });
}

const HEX = "0123456789abcdef".repeat(4);
const FORMATTED = HEX.toUpperCase().match(/../g)!.join(":");

function withData<A>(data: unknown, program: () => EffectGen<A, string, AppExpoModules.SigningCredentials>) {
  const requests: Array<{ readonly operationName: string; readonly variables: unknown; readonly document: string }> = [];
  const api = ExpoApiImpl.mockLayer({
    *graphql<S extends Schema.Top & { readonly DecodingServices: never }>(request: {
      readonly operationName: string;
      readonly document: string;
      readonly variables: Readonly<Record<string, unknown>>;
      readonly data: S;
    }): EffectGen<S["Type"], ExpoApiError> {
      requests.push(request);
      return Schema.decodeUnknownSync(request.data as any)(data) as S["Type"];
    },
  });
  return pipe(
    Effect.result(effunct(program)()),
    Effect.map((result) => ({ result, requests })),
    Effect.provide(pipe(SigningCredentialsImpl.Layer, Layer.provide(api))),
  );
}

const android = (keystores: ReadonlyArray<string | null>) => ({
  app: { byId: { id: "p", androidAppCredentials: [{ androidAppBuildCredentialsList: keystores.map((fingerprint) => ({ androidKeystore: { sha256CertificateFingerprint: fingerprint } })) }] } },
});

describe("androidFingerprints", () => {
  const read = function* () {
    return yield* (yield* appExpoModules.SigningCredentials).androidFingerprints({ projectId: "p", packageName: "sh.jive.app" });
  };

  test("lists every keystore's fingerprint once, as colon-separated uppercase hex, never asking for keystore secrets", function* () {
    const { result, requests } = yield* withData(android([HEX, FORMATTED, null]), read);
    expect(result._tag === "Success" ? result.success : undefined).toEqual([FORMATTED]);
    expect(requests[0]!.variables).toEqual({ appId: "p", packageName: "sh.jive.app" });
    expect(requests[0]!.document).toContain("androidKeystore { sha256CertificateFingerprint }");
    expect(requests[0]!.document).not.toContain("Password");
  });

  test("is empty before the package's first build", function* () {
    const { result } = yield* withData({ app: { byId: { id: "p", androidAppCredentials: [] } } }, read);
    expect(result._tag === "Success" ? result.success : undefined).toEqual([]);
  });

  test("fails on a fingerprint that is not 32 bytes", function* () {
    const { result } = yield* withData(android(["AB:CD"]), read);
    expect(result._tag).toBe("Failure");
  });
});

describe("appleTeamId", () => {
  const read = function* () {
    return yield* (yield* appExpoModules.SigningCredentials).appleTeamId({ projectId: "p", bundleIdentifier: "sh.jive.app" });
  };
  const ios = (entries: ReadonlyArray<unknown>) => ({ app: { byId: { id: "p", iosAppCredentials: entries } } });

  test("finds the team of the credentials for this bundle identifier", function* () {
    const { result } = yield* withData(ios([
      { appleTeam: { appleTeamIdentifier: "OTHER00000" }, appleAppIdentifier: { bundleIdentifier: "sh.jive.other", appleTeam: null } },
      { appleTeam: null, appleAppIdentifier: { bundleIdentifier: "sh.jive.app", appleTeam: { appleTeamIdentifier: "ABCDE12345" } } },
    ]), read);
    expect(result._tag === "Success" ? result.success : undefined).toEqual(Option.some("ABCDE12345"));
  });

  test("is None before iOS credentials are set up", function* () {
    const { result } = yield* withData(ios([]), read);
    expect(result._tag === "Success" ? result.success : undefined).toEqual(Option.none());
  });
});

test("formatSha256Fingerprint accepts EAS's spellings and rejects anything else", function* () {
  expect(formatSha256Fingerprint(HEX)).toEqual(Option.some(FORMATTED));
  expect(formatSha256Fingerprint(FORMATTED.toLowerCase())).toEqual(Option.some(FORMATTED));
  expect(Option.isNone(formatSha256Fingerprint("not a fingerprint"))).toBe(true);
});
