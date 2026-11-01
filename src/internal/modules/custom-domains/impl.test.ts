import { describe, expect, test as buntest } from "bun:test";
import { Effect, Layer, Option, Schema, pipe } from "effect";
import { effunct, type EffectGen } from "effective-modules";
import { ExpoApiImpl } from "../expo-api/impl";
import { ExpoApiRejected, type ExpoApiError } from "../expo-api/interface";
import { AppExpoModules, appExpoModules } from "../index";
import { CustomDomainsImpl } from "./impl";
import { CustomDomainChange } from "./interface";

/**
 * CustomDomainsImpl against a fake Expo API holding at most one registered domain, the way EAS does per
 * project. The response shapes follow eas-cli 25.3.0's generated GraphQL types; none were recorded live,
 * since registering a domain on a real project is an outward change this library's tests never make.
 */

function test(name: string, body: () => EffectGen<void, any, never>) {
  buntest(name, async () => { await Effect.runPromise(effunct(body)()); });
}

const PROJECT_ID = "project-1";

function workerCustomDomain(id: string, hostname: string) {
  return {
    id,
    hostname,
    dnsRecord: { dnsName: hostname, dnsType: "CNAME", dnsContent: "my-app.expo.app", isConfigured: true },
    verificationRecord: { dnsName: `_cf-custom-hostname.${hostname}`, dnsType: "TXT", dnsContent: "token", isConfigured: false },
    dcvDelegationRecord: null,
    setup: { status: "PENDING", verificationStatus: "PENDING", sslStatus: null, verificationErrors: null, sslErrors: ["waiting for DNS"] },
  };
}

/** Runs `ensure` against a fake API whose project starts with `registered`, returning operations in order. */
function ensureWith(input: {
  readonly registered: Option.Option<{ readonly id: string; readonly hostname: string }>;
  readonly hostname: string;
  readonly refuseRegistration?: boolean;
}) {
  const operations: Array<{ readonly operationName: string; readonly variables: unknown }> = [];
  let current = input.registered;
  const api = ExpoApiImpl.mockLayer({
    *graphql<S extends Schema.Top & { readonly DecodingServices: never }>(request: {
      readonly operationName: string;
      readonly document: string;
      readonly variables: Readonly<Record<string, unknown>>;
      readonly data: S;
    }): EffectGen<S["Type"], ExpoApiError> {
      operations.push({ operationName: request.operationName, variables: request.variables });
      const answer = ((): unknown => {
        switch (request.operationName) {
          case "JiveAppExpoFindCustomDomain":
            return { app: { byId: { id: PROJECT_ID, workerCustomDomain: Option.match(current, { onNone: () => null, onSome: ({ id, hostname }) => workerCustomDomain(id, hostname) }) } } };
          case "JiveAppExpoRefreshCustomDomain":
            return { customDomain: { refreshCustomDomain: workerCustomDomain(String(request.variables["customDomainId"]), Option.getOrThrow(current).hostname) } };
          case "JiveAppExpoDeleteCustomDomain":
            current = Option.none();
            return { customDomain: { deleteCustomDomain: { id: request.variables["customDomainId"] } } };
          case "JiveAppExpoRegisterCustomDomain":
            current = Option.some({ id: "new-domain", hostname: String(request.variables["hostname"]) });
            return { customDomain: { registerCustomDomain: workerCustomDomain("new-domain", String(request.variables["hostname"])) } };
          default:
            return undefined;
        }
      })();
      if (request.operationName === "JiveAppExpoRegisterCustomDomain" && input.refuseRegistration === true) {
        return yield* new ExpoApiRejected({
          operationName: request.operationName,
          errors: [{ message: "Custom domains are not available on the free plan", errorCode: Option.none(), errorType: Option.some("USER") }],
        });
      }
      return Schema.decodeUnknownSync(request.data as any)(answer) as S["Type"];
    },
  });
  return pipe(
    Effect.result(effunct(function* (): EffectGen<unknown, string, AppExpoModules.CustomDomains> {
      return yield* (yield* appExpoModules.CustomDomains).ensure({ projectId: PROJECT_ID, hostname: input.hostname });
    })()),
    Effect.map((result) => ({ result, operations: operations.map(({ operationName }) => operationName.replace("JiveAppExpo", "")), variables: operations.map(({ variables }) => variables) })),
    Effect.provide(pipe(CustomDomainsImpl.Layer, Layer.provide(api))),
  );
}

describe("ensure", () => {
  test("registers the domain when the project has none, reading first", function* () {
    const { result, operations, variables } = yield* ensureWith({ registered: Option.none(), hostname: "app.example.com" });
    expect(operations).toEqual(["FindCustomDomain", "RegisterCustomDomain"]);
    expect(variables[1]).toEqual({ appId: PROJECT_ID, hostname: "app.example.com" });
    const value = result._tag === "Success" ? result.success as any : undefined;
    expect(value.change).toEqual(CustomDomainChange.Registered());
    expect(value.domain.records.map(({ purpose, isConfigured }: any) => [purpose, isConfigured])).toEqual([["routing", true], ["ownership verification", false]]);
    expect(value.domain.setup.value.errors).toEqual(["waiting for DNS"]);
  });

  test("is idempotent: a domain already registered is only checked again, never registered twice", function* () {
    const { result, operations, variables } = yield* ensureWith({ registered: Option.some({ id: "domain-1", hostname: "App.Example.com" }), hostname: "app.example.com" });
    expect(operations).toEqual(["FindCustomDomain", "RefreshCustomDomain"]);
    expect(variables[1]).toEqual({ customDomainId: "domain-1" });
    expect(result._tag === "Success" ? (result.success as any).change : undefined).toEqual(CustomDomainChange.Refreshed());
  });

  test("replaces another hostname, since EAS holds one custom domain per project", function* () {
    const { result, operations } = yield* ensureWith({ registered: Option.some({ id: "domain-1", hostname: "old.example.com" }), hostname: "app.example.com" });
    expect(operations).toEqual(["FindCustomDomain", "DeleteCustomDomain", "RegisterCustomDomain"]);
    expect(result._tag === "Success" ? (result.success as any).change : undefined).toEqual(CustomDomainChange.Replaced({ previousHostname: "old.example.com" }));
  });

  test("a refused registration fails with EAS's reason and the paid-plan requirement", function* () {
    const { result } = yield* ensureWith({ registered: Option.none(), hostname: "app.example.com", refuseRegistration: true });
    const failure = result._tag === "Failure" ? String(result.failure) : "";
    expect(failure).toContain("Custom domains are not available on the free plan");
    expect(failure).toContain("paid EAS plan");
  });
});
