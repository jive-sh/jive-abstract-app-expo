import { expect, test } from "bun:test";
import { Option } from "effect";
import { CustomDomainChange, type CustomDomain } from "../modules/custom-domains/interface";
import { describeCustomDomain } from "./custom-domain-report";

const domain = (configured: boolean, status: string): CustomDomain => ({
  id: "d",
  hostname: "app.example.com",
  records: [
    { purpose: "routing", type: "CNAME", name: "app.example.com", content: "my-app.expo.app", isConfigured: true },
    { purpose: "ownership verification", type: "TXT", name: "_cf-custom-hostname.app.example.com", content: "token", isConfigured: configured },
  ],
  setup: Option.some({ status, verificationStatus: Option.some(status), sslStatus: Option.none(), errors: configured ? [] : ["TXT record not found"] }),
});

test("lists every record with whether it was found, and the statuses, without calling a pending domain ready", () => {
  const { text, ready } = describeCustomDomain({ change: CustomDomainChange.Registered(), domain: domain(false, "PENDING") });
  expect(ready).toBe(false);
  expect(text).toContain("registered on the EAS project by this deploy");
  expect(text).toContain("setup PENDING, ownership verification PENDING, SSL certificate not reported");
  expect(text).toContain("1 of 2 not found yet; this deploy does not create them");
  expect(text).toContain("[found  ] CNAME app.example.com -> my-app.expo.app  (routing)");
  expect(text).toContain("[missing] TXT   _cf-custom-hostname.app.example.com -> token  (ownership verification)");
  expect(text).toContain("EAS reports: TXT record not found");
});

test("is ready once every record is found and setup is active", () => {
  const { text, ready } = describeCustomDomain({ change: CustomDomainChange.Refreshed(), domain: domain(true, "ACTIVE") });
  expect(ready).toBe(true);
  expect(text).toContain("https://app.example.com/ serves production.");
});
