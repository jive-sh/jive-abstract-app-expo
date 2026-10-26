import type { EffectGen } from "effective-modules";
import type { PipelineContext } from "jive-abstract-library";

export interface IDeployer {
  /**
   * Deploys one environment: its web export to EAS Hosting at the URL `deploy:url` announced, then, for a
   * branch environment, each native platform's build (only when none exists for the runtime version) and
   * update. Fails if EAS serves the web app anywhere but the announced URL.
   */
  deploy(input: { readonly environment: string; readonly context: PipelineContext }): EffectGen<void, string>;
}
