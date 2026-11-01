import type { EffectGen } from "effective-modules";
import type { PipelineContext } from "jive-abstract-library";

export interface IDeployer {
  /**
   * Deploys one environment. For a branch environment it first starts each native platform's build when none
   * exists for the runtime version; with a custom domain it then writes the domain's association files into
   * the web export; it uploads that export to EAS Hosting at the URL `deploy:plan` announced; for production
   * it makes sure the custom domain is registered and reports its DNS records; and for a branch environment
   * it last publishes each platform's update. Fails if EAS serves the web app anywhere but the announced URL.
   */
  deploy(input: { readonly environment: string; readonly context: PipelineContext }): EffectGen<void, string>;
}
