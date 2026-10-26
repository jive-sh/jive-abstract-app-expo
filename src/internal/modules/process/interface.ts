import type { EffectGen } from "effective-modules";

export interface ProcessInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  /** Added to this process's own environment, overriding it where names collide. */
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Runs the command-line tools the hooks drive (Expo CLI, EAS CLI). Every child's stderr goes to this
 * process's stderr, because two hooks' stdout is parsed by the pipeline and must carry nothing else.
 */
export interface IProcess {
  /** Runs a command to completion and returns its stdout, failing with that output on a nonzero exit. */
  output(input: ProcessInput): EffectGen<string, string>;
  /** Runs a command whose output is only for the log, so its stdout is forwarded to stderr as it arrives. */
  run(input: ProcessInput): EffectGen<void, string>;
}
