import { appExpoModules } from "../../modules";
import { makeDeployCommand } from "../../common/command";

export const deploy = makeDeployCommand(
  "deploy",
  "publish this environment's web app to EAS Hosting, then its native apps through EAS Build and EAS Update",
  function* ({ environment, context }) {
    yield* (yield* appExpoModules.Deployer).deploy({ environment, context });
  },
);
