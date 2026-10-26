import { Effect } from "effect";
import { appConfigErrors } from "../../eas-project/requirements";
import { deployableEnvironments } from "../../hosting/web-target";
import { appExpoModules } from "../../modules";
import { renderEasJson } from "../../native/eas-json";
import { ABSTRACT_KEY } from "../../public/manifest";
import { makeCicdCommand } from "../../common/command";
import { webExportDir } from "../../common/web-export";

export const build = makeCicdCommand(
  "build",
  "check the app is ready to deploy, write eas.json, and export the web app once per environment",
  function* () {
    const config = (yield* (yield* appExpoModules.Package).load()).jive[ABSTRACT_KEY];
    const expo = yield* appExpoModules.Expo;

    const appConfig = yield* expo.readAppConfig();
    const errors = appConfigErrors(appConfig, config);
    if (errors.length > 0) {
      return yield* Effect.fail(`The app's Expo config is not ready to deploy:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
    }

    if (config.native.platforms.length > 0) {
      yield* (yield* appExpoModules.Eas).writeConfig(renderEasJson(config));
      yield* Effect.log(`Wrote eas.json with a build profile per environment: ${Object.keys(config.environments).join(", ")}`);
    }

    // One export per environment, because each inlines its own variables; deploy then uploads the one it needs.
    for (const { name, settings } of deployableEnvironments(config)) {
      const outputDir = webExportDir(name);
      yield* Effect.log(`Exporting the web app for ${name} into ${outputDir}`);
      yield* expo.exportWeb({ outputDir, variables: settings.variables });
    }
    yield* Effect.log("Build complete");
  },
);
