import { Effect, Option, Schema, pipe } from "effect";
import { implementing, type EffectGen } from "effective-modules";
import { appExpoModules } from "../index";
import type { ExpoApiError } from "../expo-api/interface";
import { CustomDomainChange, type CustomDomain, type DnsRecord, type ICustomDomains } from "./interface";

const FIELDS = `
fragment JiveAppExpoCustomDomainFields on WorkerCustomDomain {
  id
  hostname
  dnsRecord { dnsName dnsType dnsContent isConfigured }
  verificationRecord { dnsName dnsType dnsContent isConfigured }
  dcvDelegationRecord { dnsName dnsType dnsContent isConfigured }
  setup { status verificationStatus sslStatus verificationErrors sslErrors }
}`;

const FIND = `query JiveAppExpoFindCustomDomain($appId: String!) {
  app { byId(appId: $appId) { id workerCustomDomain { ...JiveAppExpoCustomDomainFields } } }
}${FIELDS}`;

const REGISTER = `mutation JiveAppExpoRegisterCustomDomain($appId: ID!, $hostname: String!) {
  customDomain { registerCustomDomain(appId: $appId, hostname: $hostname) { ...JiveAppExpoCustomDomainFields } }
}${FIELDS}`;

const REFRESH = `mutation JiveAppExpoRefreshCustomDomain($customDomainId: ID!) {
  customDomain { refreshCustomDomain(customDomainId: $customDomainId) { ...JiveAppExpoCustomDomainFields } }
}${FIELDS}`;

const DELETE = `mutation JiveAppExpoDeleteCustomDomain($customDomainId: ID!) {
  customDomain { deleteCustomDomain(customDomainId: $customDomainId) { id } }
}`;

const DnsRecordJson = Schema.Struct({
  dnsName: Schema.String,
  dnsType: Schema.String,
  dnsContent: Schema.String,
  isConfigured: Schema.Boolean,
});

/** `WorkerCustomDomain`, as `FIELDS` selects it. */
const WorkerCustomDomain = Schema.Struct({
  id: Schema.String,
  hostname: Schema.String,
  dnsRecord: DnsRecordJson,
  verificationRecord: Schema.OptionFromNullOr(DnsRecordJson),
  dcvDelegationRecord: Schema.OptionFromNullOr(DnsRecordJson),
  setup: Schema.OptionFromNullOr(Schema.Struct({
    status: Schema.String,
    verificationStatus: Schema.OptionFromNullOr(Schema.String),
    sslStatus: Schema.OptionFromNullOr(Schema.String),
    verificationErrors: Schema.OptionFromNullOr(Schema.Array(Schema.String)),
    sslErrors: Schema.OptionFromNullOr(Schema.Array(Schema.String)),
  })),
});

function toCustomDomain(domain: Schema.Schema.Type<typeof WorkerCustomDomain>): CustomDomain {
  const record = (purpose: DnsRecord["purpose"]) => ({ dnsName, dnsType, dnsContent, isConfigured }: Schema.Schema.Type<typeof DnsRecordJson>): DnsRecord =>
    ({ purpose, type: dnsType, name: dnsName, content: dnsContent, isConfigured });
  return {
    id: domain.id,
    hostname: domain.hostname,
    records: [
      record("routing")(domain.dnsRecord),
      ...Option.toArray(Option.map(domain.verificationRecord, record("ownership verification"))),
      ...Option.toArray(Option.map(domain.dcvDelegationRecord, record("certificate validation"))),
    ],
    setup: Option.map(domain.setup, (setup) => ({
      status: setup.status,
      verificationStatus: setup.verificationStatus,
      sslStatus: setup.sslStatus,
      errors: [...Option.getOrElse(setup.verificationErrors, () => []), ...Option.getOrElse(setup.sslErrors, () => [])],
    })),
  };
}

export class CustomDomainsImpl extends implementing(appExpoModules.CustomDomains).uses(appExpoModules.ExpoApi) implements ICustomDomains {
  *ensure({ projectId, hostname }: { readonly projectId: string; readonly hostname: string }): EffectGen<{ readonly change: CustomDomainChange; readonly domain: CustomDomain }, string> {
    const existing = yield* this.find(projectId);
    if (Option.isSome(existing) && existing.value.hostname.toLowerCase() === hostname) {
      return { change: CustomDomainChange.Refreshed(), domain: yield* this.refresh(existing.value.id) };
    }
    if (Option.isSome(existing)) yield* this.delete(existing.value.id);
    const domain = yield* this.register(projectId, hostname);
    return {
      change: Option.isSome(existing) ? CustomDomainChange.Replaced({ previousHostname: existing.value.hostname }) : CustomDomainChange.Registered(),
      domain,
    };
  }

  private *find(projectId: string): EffectGen<Option.Option<CustomDomain>, string> {
    const data = yield* pipe(
      this.run({
        operationName: "JiveAppExpoFindCustomDomain",
        document: FIND,
        variables: { appId: projectId },
        data: Schema.Struct({ app: Schema.Struct({ byId: Schema.Struct({ workerCustomDomain: Schema.OptionFromNullOr(WorkerCustomDomain) }) }) }),
      }),
      Effect.mapError((e) => `Cannot read the custom domain of EAS project ${projectId}. ${e.description}`),
    );
    return Option.map(data.app.byId.workerCustomDomain, toCustomDomain);
  }

  private *register(projectId: string, hostname: string): EffectGen<CustomDomain, string> {
    const data = yield* pipe(
      this.run({
        operationName: "JiveAppExpoRegisterCustomDomain",
        document: REGISTER,
        variables: { appId: projectId, hostname },
        data: Schema.Struct({ customDomain: Schema.Struct({ registerCustomDomain: WorkerCustomDomain }) }),
      }),
      Effect.catchTag("ExpoApiRejected", (e) => Effect.fail(
        `EAS refused to register ${hostname} as the custom domain of project ${projectId}: ${e.errors.map(({ message }) => message).join("; ")}. `
        + "Custom domains need a paid EAS plan on the account that owns the project (https://expo.dev/pricing), "
        + "and the EXPO_TOKEN's role must be allowed to change the project's hosting settings.",
      )),
      Effect.mapError((e) => (typeof e === "string" ? e : `Cannot register ${hostname}. ${e.description}`)),
    );
    return toCustomDomain(data.customDomain.registerCustomDomain);
  }

  private *refresh(customDomainId: string): EffectGen<CustomDomain, string> {
    const data = yield* pipe(
      this.run({
        operationName: "JiveAppExpoRefreshCustomDomain",
        document: REFRESH,
        variables: { customDomainId },
        data: Schema.Struct({ customDomain: Schema.Struct({ refreshCustomDomain: WorkerCustomDomain }) }),
      }),
      Effect.mapError((e) => `Cannot check custom domain ${customDomainId} again. ${e.description}`),
    );
    return toCustomDomain(data.customDomain.refreshCustomDomain);
  }

  private *delete(customDomainId: string): EffectGen<void, string> {
    yield* pipe(
      this.run({
        operationName: "JiveAppExpoDeleteCustomDomain",
        document: DELETE,
        variables: { customDomainId },
        data: Schema.Struct({ customDomain: Schema.Struct({ deleteCustomDomain: Schema.Struct({ id: Schema.String }) }) }),
      }),
      Effect.mapError((e) => `Cannot remove custom domain ${customDomainId}. ${e.description}`),
    );
  }

  private run<S extends Schema.Top & { readonly DecodingServices: never }>(input: {
    readonly operationName: string;
    readonly document: string;
    readonly variables: Readonly<Record<string, unknown>>;
    readonly data: S;
  }): Effect.Effect<S["Type"], ExpoApiError> {
    const api = this.dependencies.ExpoApi;
    return Effect.gen(function* () { return yield* api.graphql(input); });
  }
}
