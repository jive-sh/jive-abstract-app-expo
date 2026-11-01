import { describe, expect, test as buntest } from "bun:test";
import { Effect, FileSystem, Layer, Option, pipe } from "effect";
import { effunct, type EffectGen } from "effective-modules";
import { resolve } from "node:path";
import { GENERATED_APP_CONFIG_FILE, GENERATED_APP_CONFIG_MARKER } from "../../linking/app-config";
import { AppExpoModules, appExpoModules } from "../index";
import { ProcessImpl } from "../process/impl";
import { ExpoImpl } from "./impl";

function test(name: string, body: () => EffectGen<void, any, never>) {
  buntest(name, async () => { await Effect.runPromise(effunct(body)()); });
}

const GENERATED = `${GENERATED_APP_CONFIG_MARKER} ...\nmodule.exports = ({ config }) => config;\n`;

/** Runs writeGeneratedConfig against a fake app folder holding `files`, returning the folder afterwards. */
function writeWith(files: Readonly<Record<string, string>>, source: Option.Option<string>) {
  const folder = new Map(Object.entries(files).map(([name, text]) => [resolve(process.cwd(), name), text]));
  const fileSystem = FileSystem.layerNoop({
    exists: (path) => Effect.succeed(folder.has(path)),
    readFileString: (path) => Effect.succeed(folder.get(path) ?? ""),
    writeFileString: (path, text) => Effect.sync(() => { folder.set(path, text); }),
    remove: (path) => Effect.sync(() => { folder.delete(path); }),
  });
  return pipe(
    Effect.result(effunct(function* (): EffectGen<void, string, AppExpoModules.Expo> {
      yield* (yield* appExpoModules.Expo).writeGeneratedConfig(source);
    })()),
    Effect.map((result) => ({ result, files: Object.fromEntries([...folder].map(([path, text]) => [path.slice(process.cwd().length + 1), text])) })),
    Effect.provide(pipe(ExpoImpl.Layer, Layer.provide(Layer.mergeAll(ProcessImpl.mockLayer({}), fileSystem)))),
  );
}

describe("writeGeneratedConfig", () => {
  test("writes the config beside app.json, and rewrites its own on the next build", function* () {
    const first = yield* writeWith({ "app.json": "{}" }, Option.some(GENERATED));
    expect(first.files[GENERATED_APP_CONFIG_FILE]).toBe(GENERATED);
    const again = yield* writeWith(first.files, Option.some(`${GENERATED}// changed\n`));
    expect(again.result._tag).toBe("Success");
    expect(again.files[GENERATED_APP_CONFIG_FILE]).toBe(`${GENERATED}// changed\n`);
  });

  test("with nothing to generate, removes the one an earlier build wrote and nothing else", function* () {
    expect((yield* writeWith({ "app.json": "{}", [GENERATED_APP_CONFIG_FILE]: GENERATED }, Option.none())).files).toEqual({ "app.json": "{}" });
    const own = { "app.json": "{}", [GENERATED_APP_CONFIG_FILE]: "module.exports = () => ({});\n" };
    expect((yield* writeWith(own, Option.none())).files).toEqual(own);
  });

  test("refuses to generate beside the app's own dynamic config, which Expo would read instead or lose", function* () {
    for (const file of ["app.config.ts", "app.config.js", GENERATED_APP_CONFIG_FILE]) {
      const { result, files } = yield* writeWith({ "app.json": "{}", [file]: "export default {};\n" }, Option.some(GENERATED));
      expect(result._tag === "Failure" ? result.failure : "").toContain(`The app has its own ${file}`);
      expect(files[file]).toBe("export default {};\n");
    }
  });
});
