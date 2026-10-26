import { Command } from "commander";
import { Effect } from "effect";
import { runDevServer } from "jive-abstract-library";
import { PackageJsonSchema } from "../public/manifest";

/** `jive-app-expo dev`: keeps the package's package.schema.json current while its package.json is edited. */
export const dev = new Command("dev")
  .description("watch this package and keep its generated package.schema.json current while you work")
  .action(() => runDevServer({ genPackageJsonSchema: Effect.succeed(PackageJsonSchema), watchPaths: ["package.json"] }));
