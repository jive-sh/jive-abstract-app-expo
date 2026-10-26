import { expect, test } from "bun:test";
import { Schema } from "effect";
import { AppExpoSchema } from "../public/manifest";
import { renderEasJson } from "./eas-json";

test("each environment becomes a build profile and update channel named in lowercase, preview excluded", () => {
  const config = Schema.decodeUnknownSync(AppExpoSchema)({
    web: { subdomain: "my-app", customDomain: null },
    native: { platforms: ["android"], distribution: "internal" },
    environments: {
      Production: { web: "production", easEnvironment: "production", variables: { EXPO_PUBLIC_SERVER_URL: "https://api.example.com" } },
    },
    preview: { easEnvironment: "preview", variables: {} },
  });
  const easJson = JSON.parse(renderEasJson(config));
  expect(Object.keys(easJson.build)).toEqual(["production"]);
  expect(easJson.build.production).toEqual({
    channel: "production",
    distribution: "internal",
    environment: "production",
    env: { EXPO_PUBLIC_SERVER_URL: "https://api.example.com" },
    autoIncrement: true,
    android: { buildType: "apk" },
  });
  expect(easJson.cli.appVersionSource).toBe("remote");
});
