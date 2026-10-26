import { Effect, Stream, pipe } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { implementing, type EffectGen } from "effective-modules";
import { appExpoModules } from "../index";
import type { IProcess, ProcessInput, ProcessResult } from "./interface";

function describe(input: ProcessInput): string {
  return [input.command, ...input.args].join(" ");
}

/** The text a stream carried, written to this process's stderr as it arrives. */
function forwardToStderr<E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> {
  return pipe(
    stream,
    Stream.tap((chunk) => Effect.sync(() => { process.stderr.write(chunk); })),
    Stream.decodeText(),
    Stream.mkString,
  );
}

function failure(input: ProcessInput, result: ProcessResult): string {
  const output = [result.stdout.trim(), result.stderr.trim()].filter((text) => text !== "").join("\n");
  return `${describe(input)} exited with code ${result.exitCode}${output === "" ? "" : `:\n${output}`}`;
}

export class ProcessImpl extends implementing(appExpoModules.Process).uses(ChildProcessSpawner.ChildProcessSpawner) implements IProcess {
  *result(input: ProcessInput): EffectGen<ProcessResult, string> {
    return yield* this.spawn(input, { forwardStdout: false });
  }

  *output(input: ProcessInput): EffectGen<string, string> {
    const result = yield* this.spawn(input, { forwardStdout: false });
    if (result.exitCode !== 0) return yield* Effect.fail(failure(input, result));
    return result.stdout;
  }

  *run(input: ProcessInput): EffectGen<void, string> {
    const result = yield* this.spawn(input, { forwardStdout: true });
    if (result.exitCode !== 0) return yield* Effect.fail(`${describe(input)} exited with code ${result.exitCode}`);
  }

  private *spawn(input: ProcessInput, options: { readonly forwardStdout: boolean }): EffectGen<ProcessResult, string> {
    const spawner = this.getDependency(ChildProcessSpawner.ChildProcessSpawner);
    return yield* pipe(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(ChildProcess.make(input.command, [...input.args], {
          cwd: input.cwd,
          env: input.env,
          extendEnv: true,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        }));
        const [stdout, stderr, exitCode] = yield* Effect.all([
          options.forwardStdout ? forwardToStderr(handle.stdout) : pipe(handle.stdout, Stream.decodeText(), Stream.mkString),
          forwardToStderr(handle.stderr),
          handle.exitCode,
        ], { concurrency: 3 });
        return { exitCode: Number(exitCode), stdout, stderr };
      }),
      Effect.scoped,
      Effect.mapError((e) => `Cannot run ${describe(input)}: ${e.message}`),
    );
  }
}
