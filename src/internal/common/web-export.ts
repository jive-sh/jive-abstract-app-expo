import { join } from "node:path";
import { WEB_EXPORT_DIR } from "./constants";

/**
 * The folder one environment's web export lives in, relative to the app's root, where every hook runs.
 * Relative because `eas deploy` joins `--export-dir` onto the project directory, so an absolute path names a
 * folder that does not exist. The environment name is encoded so any name maps to exactly one folder.
 */
export function webExportDir(environment: string): string {
  return join(WEB_EXPORT_DIR, encodeURIComponent(environment));
}
