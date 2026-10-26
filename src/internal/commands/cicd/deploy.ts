import { Effect, Option } from "effect";
import { environmentSettings, planWebDeployment } from "../../hosting/web-target";
import { appExpoModules } from "../../modules";
import { ABSTRACT_KEY, PREVIEW_ENVIRONMENT } from "../../public/manifest";
import { makeDeployCommand } from "../../common/command";
import { webExportDir } from "../../common/web-export";

export const deploy = makeDeployCommand(
  "deploy",
  "publish this environment's web app to EAS Hosting, then its native apps through EAS Build and EAS Update",
  function* ({ environment, context }) {
    const config = (yield* (yield* appExpoModules.Package).load()).jive[ABSTRACT_KEY];
    const eas = yield* appExpoModules.Eas;
    const plan = planWebDeployment({ config, environment, context });
    const settings = environmentSettings(config, environment);
    if (Option.isNone(plan) || Option.isNone(settings)) {
      return yield* Effect.fail(`"${environment}" is not an environment this package deploys`);
    }
    const message = `${context.sourceBranch}@${context.sourceCommitSha}`;

    yield* Effect.log(`Deploying the ${environment} web app as ${plan.value.id}, served at ${plan.value.url}`);
    const deployment = yield* eas.deployWeb({
      exportDir: webExportDir(environment),
      subdomain: config.web.subdomain,
      id: plan.value.id,
      promotion: plan.value.promotion,
      easEnvironment: settings.value.easEnvironment,
    });
    // deploy:url already announced a URL; a different one here means the prediction is wrong for this
    // project (a custom domain, say, which EAS does not report), and the pipeline's link would mislead.
    const predicted = Option.isSome(config.web.customDomain) && plan.value.promotion._tag === "Production"
      ? `https://${config.web.subdomain}.expo.app/`
      : plan.value.url;
    if (new URL(deployment.url).href !== new URL(predicted).href) {
      return yield* Effect.fail(`EAS served deployment ${deployment.identifier} at ${deployment.url}, but deploy:url announced ${predicted}`);
    }
    yield* Effect.log(`Deployed ${deployment.identifier}; ${environment} is live at ${plan.value.url}`);

    if (environment === PREVIEW_ENVIRONMENT) {
      if (config.native.platforms.length > 0) yield* Effect.log("Previews deploy the web app only; native apps update from branch deploys");
      return;
    }

    if (config.native.platforms.length === 0) return;
    const runtimeVersion = (yield* (yield* appExpoModules.Expo).readAppConfig()).runtimeVersion;
    if (Option.isNone(runtimeVersion)) return yield* Effect.fail("expo.runtimeVersion is not set; build should have stopped on this");
    for (const platform of config.native.platforms) {
      const existing = yield* eas.findBuild({ platform, profile: environment, runtimeVersion: runtimeVersion.value });
      if (Option.isSome(existing)) {
        yield* Effect.log(`${platform}: build ${existing.value.id} (${existing.value.status}) already runs runtime ${runtimeVersion.value}`);
      } else {
        const started = yield* eas.startBuild({ platform, profile: environment, message });
        yield* Effect.log(`${platform}: no build runs runtime ${runtimeVersion.value}, so started build ${started.id}`);
      }
      yield* eas.publishUpdate({
        platform,
        channel: environment,
        easEnvironment: settings.value.easEnvironment,
        message,
        variables: settings.value.variables,
      });
      yield* Effect.log(`${platform}: published an update to channel ${environment}`);
    }
  },
);
