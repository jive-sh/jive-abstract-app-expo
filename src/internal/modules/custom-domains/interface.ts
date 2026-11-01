import { Data, type Option } from "effect";
import type { EffectGen } from "effective-modules";

/** `PENDING`, `ACTIVE`, `ERROR` or `TIMED_OUT` (EAS's `CustomDomainStatus`). */
export type CustomDomainStatus = string;

/** One DNS record the domain needs at its DNS provider, and whether EAS last found it there. */
export interface DnsRecord {
  /** What the record does for the domain. */
  readonly purpose: "routing" | "ownership verification" | "certificate validation";
  readonly type: string;
  readonly name: string;
  readonly content: string;
  readonly isConfigured: boolean;
}

export interface CustomDomain {
  readonly id: string;
  readonly hostname: string;
  readonly records: ReadonlyArray<DnsRecord>;
  /** None until EAS has started setting the domain up. */
  readonly setup: Option.Option<{
    readonly status: CustomDomainStatus;
    readonly verificationStatus: Option.Option<CustomDomainStatus>;
    readonly sslStatus: Option.Option<CustomDomainStatus>;
    readonly errors: ReadonlyArray<string>;
  }>;
}

/** What `ensure` had to do to make the hostname the project's custom domain. */
export type CustomDomainChange = Data.TaggedEnum<{
  /** It was already registered; its DNS and certificate status were checked again. */
  Refreshed: {};
  Registered: {};
  /** The project served another hostname, which was removed first: EAS allows one per project. */
  Replaced: { readonly previousHostname: string };
}>;
export const CustomDomainChange = Data.taggedEnum<CustomDomainChange>();

/**
 * The custom domain of a project's EAS Hosting production deployment.
 *
 * Expo's documentation only describes assigning one in the dashboard
 * (https://docs.expo.dev/eas/hosting/custom-domain/); this module drives the GraphQL mutations the dashboard uses
 * (`customDomain.registerCustomDomain`, `refreshCustomDomain`, `deleteCustomDomain` and `App.workerCustomDomain`,
 * typed in eas-cli 25.3.0's `build/graphql/generated.d.ts`). Nothing else in this abstract knows they exist, so a
 * change on Expo's side is fixed here alone.
 */
export interface ICustomDomains {
  /**
   * Makes `hostname` the project's custom domain: reads what is registered first and registers only when it is
   * missing, so every deploy can call it. Fails with a message naming the paid-plan requirement when EAS refuses.
   */
  ensure(input: { readonly projectId: string; readonly hostname: string }): EffectGen<{ readonly change: CustomDomainChange; readonly domain: CustomDomain }, string>;
}
