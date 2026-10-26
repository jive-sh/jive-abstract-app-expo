import type { EffectGen } from "effective-modules";

export interface ProcessInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  /** Added to this process's own environment, overriding it where names collide. */
  readonly env: Readonly<Record<string, string>>;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs the command-line tools the hooks drive (Expo CLI, EAS CLI). Every child's stderr is forwarded to this
 * process's stderr as it arrives, because two hooks' stdout is parsed by the pipeline and must carry nothing
 * else; it is also kept, so a caller can tell one failure from another.
 */
export interface IProcess {
  /** Runs a command to completion, whatever its exit code; fails only when it cannot be run at all. */
  result(input: ProcessInput): EffectGen<ProcessResult, string>;
  /** Runs a command to completion and returns its stdout, failing with its output on a nonzero exit. */
  output(input: ProcessInput): EffectGen<string, string>;
  /** Runs a command whose output is only for the log, so its stdout is forwarded to stderr as well. */
  run(input: ProcessInput): EffectGen<void, string>;
}
