import { Effect, FileSystem, pipe } from "effect";
import { join } from "node:path";
import { deployableEnvironments } from "../../hosting/web-target";
import { appExpoModules } from "../../modules";
import { ABSTRACT_KEY } from "../../public/manifest";
import { makeCicdCommand } from "../../common/command";
import { webExportDir } from "../../common/web-export";

export const audit = makeCicdCommand(
  "audit",
  "check build exported a web app for every environment this package deploys",
  function* () {
    const config = (yield* (yield* appExpoModules.Package).load()).jive[ABSTRACT_KEY];
    const fs = yield* FileSystem.FileSystem;
    const missing: Array<string> = [];
    for (const { name: environment } of deployableEnvironments(config)) {
      const indexHtml = join(webExportDir(environment), "index.html");
      const exists = yield* pipe(fs.exists(indexHtml), Effect.mapError((e) => `Cannot check for ${indexHtml}: ${e.message}`));
      if (!exists) missing.push(`${environment} (${indexHtml})`);
    }
    if (missing.length > 0) return yield* Effect.fail(`No web export for ${missing.join(", ")}; run jive:cicd:build first`);
    yield* Effect.log("Every environment has a web export");
  },
);
