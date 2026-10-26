import { Effect, Option } from "effect";
import { planWebDeployment } from "../../hosting/web-target";
import { appExpoModules } from "../../modules";
import { ABSTRACT_KEY } from "../../public/manifest";
import { makeDeployPlanCommand } from "../../common/command";

export const deployPlan = makeDeployPlanCommand(
  "deploy-plan",
  "plan a deploy to the URL this environment's web app will be served at",
  function* ({ environment, context }) {
    const config = (yield* (yield* appExpoModules.Package).load()).jive[ABSTRACT_KEY];
    const plan = planWebDeployment({ config, environment, context });
    if (Option.isNone(plan)) return yield* Effect.fail(`"${environment}" is not an environment this package deploys`);
    yield* Effect.log(`${environment} is served at ${plan.value.url}`);
    return { deploy: true, url: plan.value.url } as const;
  },
);
