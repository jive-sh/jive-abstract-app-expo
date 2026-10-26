import { Effect, Stream, pipe } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { implementing, type EffectGen } from "effective-modules";
import { appExpoModules } from "../index";
import type { IProcess, ProcessInput } from "./interface";

function describe(input: ProcessInput): string {
  return [input.command, ...input.args].join(" ");
}

function command(input: ProcessInput) {
  return ChildProcess.make(input.command, [...input.args], {
    cwd: input.cwd,
    env: input.env,
    extendEnv: true,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });
}

export class ProcessImpl extends implementing(appExpoModules.Process).uses(ChildProcessSpawner.ChildProcessSpawner) implements IProcess {
  *output(input: ProcessInput): EffectGen<string, string> {
    const spawner = this.getDependency(ChildProcessSpawner.ChildProcessSpawner);
    const { stdout, exitCode } = yield* pipe(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(command(input));
        const [text, code] = yield* Effect.all([
          pipe(handle.stdout, Stream.decodeText(), Stream.mkString),
          handle.exitCode,
        ], { concurrency: 2 });
        return { stdout: text, exitCode: code };
      }),
      Effect.scoped,
      Effect.mapError((e) => `Cannot run ${describe(input)}: ${e.message}`),
    );
    if (exitCode !== 0) {
      return yield* Effect.fail(`${describe(input)} exited with code ${exitCode}${stdout.trim() === "" ? "" : `:\n${stdout.trim()}`}`);
    }
    return stdout;
  }

  *run(input: ProcessInput): EffectGen<void, string> {
    const spawner = this.getDependency(ChildProcessSpawner.ChildProcessSpawner);
    const exitCode = yield* pipe(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(command(input));
        const [, code] = yield* Effect.all([
          Stream.runForEach(handle.stdout, (chunk) => Effect.sync(() => { process.stderr.write(chunk); })),
          handle.exitCode,
        ], { concurrency: 2 });
        return code;
      }),
      Effect.scoped,
      Effect.mapError((e) => `Cannot run ${describe(input)}: ${e.message}`),
    );
    if (exitCode !== 0) return yield* Effect.fail(`${describe(input)} exited with code ${exitCode}`);
  }
}
