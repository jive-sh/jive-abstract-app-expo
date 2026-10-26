import type { EffectGen } from "effective-modules";
import type { PackageJson } from "../../public/manifest";

export interface IPackage {
  /**
   * Reads ./package.json and validates it against this abstract's schema, including the rules that span
   * `jive.cicd` and `jive.app-expo`, so no hook acts on a manifest that would fail another.
   */
  load(): EffectGen<PackageJson, string>;
}
