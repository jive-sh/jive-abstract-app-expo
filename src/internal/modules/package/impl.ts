import { Effect, FileSystem, pipe } from "effect";
import { implementing, type EffectGen } from "effective-modules";
import { loadPackageJson } from "jive-abstract-library";
import { ABSTRACT_KEY, PackageJsonSchema, crossFieldErrors, type PackageJson } from "../../public/manifest";
import { appExpoModules } from "../index";
import type { IPackage } from "./interface";

export class PackageImpl extends implementing(appExpoModules.Package).uses(FileSystem.FileSystem) implements IPackage {
  *load(): EffectGen<PackageJson, string> {
    const packageJson = yield* pipe(
      loadPackageJson(PackageJsonSchema),
      Effect.provideService(FileSystem.FileSystem, this.getDependency(FileSystem.FileSystem)),
    );
    const errors = crossFieldErrors(packageJson.jive.cicd, packageJson.jive[ABSTRACT_KEY]);
    if (errors.length > 0) {
      return yield* Effect.fail(`package.json is inconsistent:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
    }
    return packageJson;
  }
}
