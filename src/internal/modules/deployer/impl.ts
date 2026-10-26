import { Effect, Option } from "effect";
import { implementing, type EffectGen } from "effective-modules";
import type { PipelineContext } from "jive-abstract-library";
import { webExportDir } from "../../common/web-export";
import { environmentSettings, planWebDeployment, productionExpoAppUrl } from "../../hosting/web-target";
import { nativeChannel } from "../../native/eas-json";
import { ABSTRACT_KEY, PREVIEW_ENVIRONMENT } from "../../public/manifest";
import { appExpoModules } from "../index";
import type { IDeployer } from "./interface";

export class DeployerImpl extends implementing(appExpoModules.Deployer).uses(
  appExpoModules.Package,
  appExpoModules.Expo,
  appExpoModules.Eas,
) implements IDeployer {
  *deploy({ environment, context }: { readonly environment: string; readonly context: PipelineContext }): EffectGen<void, string> {
    const { Package, Expo, Eas } = this.dependencies;
    const config = (yield* Package.load()).jive[ABSTRACT_KEY];
    const plan = planWebDeployment({ config, environment, context });
    const settings = environmentSettings(config, environment);
    if (Option.isNone(plan) || Option.isNone(settings)) {
      return yield* Effect.fail(`"${environment}" is not an environment this package deploys`);
    }
    const message = `${context.sourceBranch}@${context.sourceCommitSha}`;

    yield* Effect.log(`Deploying the ${environment} web app as ${plan.value.id}, served at ${plan.value.url}`);
    const deployment = yield* Eas.deployWeb({
      exportDir: webExportDir(environment),
      subdomain: config.web.subdomain,
      id: plan.value.id,
      promotion: plan.value.promotion,
      easEnvironment: settings.value.easEnvironment,
    });
    // deploy:plan already announced a URL, and the pipeline links to it; EAS reporting another means that
    // link would mislead. EAS reports production at its expo.app URL even when a custom domain is set.
    const expected = Option.isSome(config.web.customDomain) && plan.value.promotion._tag === "Production"
      ? productionExpoAppUrl(config.web.subdomain)
      : plan.value.url;
    if (new URL(deployment.url).href !== new URL(expected).href) {
      return yield* Effect.fail(`EAS served deployment ${deployment.identifier} at ${deployment.url}, but deploy:plan announced ${expected}`);
    }
    yield* Effect.log(`Deployed ${deployment.identifier}; ${environment} is live at ${plan.value.url}`);

    if (environment === PREVIEW_ENVIRONMENT) {
      if (config.native.platforms.length > 0) yield* Effect.log("Previews deploy the web app only; native apps update from branch deploys");
      return;
    }
    if (config.native.platforms.length === 0) return;

    const { runtimeVersion } = yield* Expo.readAppConfig();
    if (Option.isNone(runtimeVersion)) return yield* Effect.fail("expo.runtimeVersion is not set; build should have stopped on this");
    const channel = nativeChannel(environment);
    for (const platform of config.native.platforms) {
      const existing = yield* Eas.findBuild({ platform, profile: channel, runtimeVersion: runtimeVersion.value });
      if (Option.isSome(existing)) {
        yield* Effect.log(`${platform}: build ${existing.value.id} (${existing.value.status}) already runs runtime ${runtimeVersion.value}`);
      } else {
        const started = yield* Eas.startBuild({ platform, profile: channel, message });
        yield* Effect.log(`${platform}: no build runs runtime ${runtimeVersion.value}, so started build ${started.id}`);
      }
      yield* Eas.publishUpdate({ platform, channel, easEnvironment: settings.value.easEnvironment, message, variables: settings.value.variables });
      yield* Effect.log(`${platform}: published an update to channel ${channel}`);
    }
  }
}
