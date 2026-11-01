import { expect, test } from "bun:test";
import { buildPageUrl, renderInstallLinks } from "./install-links";

test("the link is the build's page on expo.dev, which installs an internal build for anyone with it", () => {
  expect(buildPageUrl({ owner: "jive-sh", slug: "jive-sh", buildId: "41ff85c5-10d3-4adc-93a8-bfed79e7e629" }))
    .toBe("https://expo.dev/accounts/jive-sh/projects/jive-sh/builds/41ff85c5-10d3-4adc-93a8-bfed79e7e629");
  expect(JSON.parse(renderInstallLinks({ android: { buildId: "b", url: "u" } }))).toEqual({ android: { buildId: "b", url: "u" } });
});
