import { afterAll, describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppExpoSchema } from "../public/manifest";
import { GENERATED_APP_CONFIG_MARKER, nativeLinkingConfig, renderAppConfig } from "./app-config";

const config = (customDomain: string | null, platforms: ReadonlyArray<string>) => Schema.decodeUnknownSync(AppExpoSchema)({
  web: { subdomain: "my-app", customDomain },
  native: { platforms, distribution: "internal" },
  environments: { Production: { web: "production", easEnvironment: "production", variables: {} } },
  preview: null,
});

const APP_LINK = {
  action: "VIEW",
  autoVerify: true,
  data: [{ scheme: "https", host: "app.example.com" }],
  category: ["BROWSABLE", "DEFAULT"],
};

const scratch = mkdtempSync(join(tmpdir(), "jive-abstract-app-expo-app-config-"));
afterAll(() => { rmSync(scratch, { recursive: true, force: true }); });

/** Loads the generated source the way Expo does, as a CommonJS module exporting `({ config }) => config`. */
function evaluate(source: string, appJson: Record<string, unknown>): Record<string, any> {
  const path = join(scratch, `app.config.${Math.random().toString(36).slice(2)}.cjs`);
  writeFileSync(path, source);
  return createRequire(import.meta.url)(path)({ config: appJson });
}

describe("nativeLinkingConfig", () => {
  test("adds the associated domain and the App Link intent filter for each built platform", () => {
    expect(Option.getOrThrow(nativeLinkingConfig(config("app.example.com", ["ios", "android"])))).toEqual({
      ios: { associatedDomains: ["applinks:app.example.com"] },
      android: { intentFilters: [APP_LINK] },
    });
    expect(Object.keys(Option.getOrThrow(nativeLinkingConfig(config("app.example.com", ["android"]))))).toEqual(["android"]);
  });

  test("is None without a custom domain or without native apps, so nothing is generated", () => {
    expect(Option.isNone(nativeLinkingConfig(config(null, ["ios", "android"])))).toBe(true);
    expect(Option.isNone(nativeLinkingConfig(config("app.example.com", [])))).toBe(true);
  });
});

describe("the generated app config", () => {
  const linking = Option.getOrThrow(nativeLinkingConfig(config("app.example.com", ["ios", "android"])));
  const source = renderAppConfig(linking);

  test("starts with the marker that tells it apart from an app's own", () => {
    expect(source.startsWith(GENERATED_APP_CONFIG_MARKER)).toBe(true);
  });

  test("adds the entries to app.json's config and keeps everything else", () => {
    const result = evaluate(source, { name: "my-app", ios: { bundleIdentifier: "sh.jive.app" }, android: { package: "sh.jive.app" } });
    expect(result).toEqual({
      name: "my-app",
      ios: { bundleIdentifier: "sh.jive.app", associatedDomains: ["applinks:app.example.com"] },
      android: { package: "sh.jive.app", intentFilters: [APP_LINK] },
    });
  });

  test("keeps the app's own entries and adds none twice", () => {
    const own = { action: "VIEW", data: [{ scheme: "myapp" }], category: ["DEFAULT"] };
    const result = evaluate(source, {
      ios: { associatedDomains: ["applinks:app.example.com", "webcredentials:app.example.com"] },
      android: { intentFilters: [own, APP_LINK] },
    });
    expect(result["ios"].associatedDomains).toEqual(["applinks:app.example.com", "webcredentials:app.example.com"]);
    expect(result["android"].intentFilters).toEqual([own, APP_LINK]);
  });
});
