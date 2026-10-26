import { resolve } from "node:path";
import { WEB_EXPORT_DIR } from "./constants";

/**
 * The folder one environment's web export lives in. The name is encoded so any environment name maps to
 * exactly one folder and no two names share one.
 */
export function webExportDir(environment: string): string {
  return resolve(process.cwd(), WEB_EXPORT_DIR, encodeURIComponent(environment));
}
