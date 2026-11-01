import { Option } from "effect";
import { CustomDomainChange, type CustomDomain } from "../modules/custom-domains/interface";

const ACTIVE = "ACTIVE";

/**
 * What the deploy log says about the custom domain: what this deploy changed, EAS's setup status, and every DNS
 * record the domain needs with whether EAS found it. Creating the records is the domain owner's step, so a
 * missing one is reported, never a failure; `ready` is true once EAS serves the domain over HTTPS.
 */
export function describeCustomDomain(input: { readonly change: CustomDomainChange; readonly domain: CustomDomain }): { readonly text: string; readonly ready: boolean } {
  const { change, domain } = input;
  const what = CustomDomainChange.$match(change, {
    Registered: () => "registered on the EAS project by this deploy",
    Refreshed: () => "already registered; EAS checked its DNS and certificate again",
    Replaced: ({ previousHostname }) => `registered by this deploy, replacing ${previousHostname} (EAS allows one custom domain per project)`,
  });
  const status = Option.match(domain.setup, {
    onNone: () => "EAS has not reported a setup status yet",
    onSome: ({ status, verificationStatus, sslStatus }) =>
      `setup ${status}, ownership verification ${Option.getOrElse(verificationStatus, () => "not reported")}, SSL certificate ${Option.getOrElse(sslStatus, () => "not reported")}`,
  });
  const errors = Option.match(domain.setup, { onNone: () => [], onSome: ({ errors }) => errors });
  const missing = domain.records.filter(({ isConfigured }) => !isConfigured);
  const ready = missing.length === 0 && Option.exists(domain.setup, ({ status }) => status === ACTIVE);

  const lines = [
    `Custom domain ${domain.hostname}: ${what}.`,
    `  Status: ${status}.`,
    `  DNS records it needs at its DNS provider (${missing.length === 0 ? "all found" : `${missing.length} of ${domain.records.length} not found yet; this deploy does not create them`}):`,
    ...domain.records.map((record) => `    [${record.isConfigured ? "found  " : "missing"}] ${record.type.padEnd(5)} ${record.name} -> ${record.content}  (${record.purpose})`),
    ...errors.map((error) => `  EAS reports: ${error}`),
    ready
      ? `  https://${domain.hostname}/ serves production.`
      : `  https://${domain.hostname}/ serves production once every record is found and the status is ${ACTIVE}; the next deploy checks again.`,
  ];
  return { text: lines.join("\n"), ready };
}
