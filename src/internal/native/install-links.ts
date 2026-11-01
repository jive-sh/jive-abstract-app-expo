import type { NativePlatform } from "../public/manifest";

/**
 * Where each internally distributed native app installs from, served by every web export so the web app can show
 * it (a QR code on a computer, a link on a phone). An internal build's page on expo.dev installs the app for anyone
 * with its URL (https://docs.expo.dev/build/internal-distribution/), so the link is the page of the newest build of
 * the environment's profile, which the deploy has just found or started. Store builds install from the stores, so
 * `"distribution": "store"` writes no file.
 */
export const INSTALL_LINKS_PATH = "install-links.json";

export interface InstallLink {
  readonly buildId: string;
  readonly url: string;
}

export type InstallLinks = Partial<Record<NativePlatform, InstallLink>>;

export function buildPageUrl(input: { readonly owner: string; readonly slug: string; readonly buildId: string }): string {
  return `https://expo.dev/accounts/${encodeURIComponent(input.owner)}/projects/${encodeURIComponent(input.slug)}/builds/${encodeURIComponent(input.buildId)}`;
}

export function renderInstallLinks(links: InstallLinks): string {
  return `${JSON.stringify(links, null, 2)}\n`;
}
