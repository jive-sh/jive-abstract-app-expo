import { Effect, FileSystem, Option, pipe } from "effect";
import { implementing, type EffectGen } from "effective-modules";
import type { PipelineContext } from "jive-abstract-library";
import { join } from "node:path";
import { webExportDir } from "../../common/web-export";
import { describeCustomDomain } from "../../hosting/custom-domain-report";
import { environmentSettings, planWebDeployment, productionExpoAppUrl } from "../../hosting/web-target";
import {
  APPLE_APP_SITE_ASSOCIATION_PATH,
  ASSET_LINKS_PATH,
  renderAppleAppSiteAssociation,
  renderAssetLinks,
} from "../../linking/well-known";
import { nativeChannel } from "../../native/eas-json";
import { ABSTRACT_KEY, PREVIEW_ENVIRONMENT, type AppExpoConfig } from "../../public/manifest";
import type { AppConfig } from "../expo/interface";
import { appExpoModules } from "../index";
import type { IDeployer } from "./interface";

export class DeployerImpl extends implementing(appExpoModules.Deployer).uses(
  appExpoModules.Package,
  appExpoModules.Expo,
  appExpoModules.Eas,
  appExpoModules.CustomDomains,
  appExpoModules.SigningCredentials,
  FileSystem.FileSystem,
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
    const { platforms } = config.native;
    const updatesNativeApps = environment !== PREVIEW_ENVIRONMENT && platforms.length > 0;
    const appConfig = platforms.length > 0 || Option.isSome(config.domain) ? Option.some(yield* Expo.readAppConfig()) : Option.none<AppConfig>();

    // Builds start first: a project's first one generates its Android keystore, whose fingerprint the web
    // export's assetlinks.json must carry from the first release on.
    if (updatesNativeApps) {
      const resolved = Option.flatMap(appConfig, (app) => app.runtimeVersion);
      if (Option.isNone(resolved)) return yield* Effect.fail("expo.runtimeVersion is not set; build should have stopped on this");
      const runtimeVersion = resolved.value;
      for (const platform of platforms) {
        const existing = yield* Eas.findBuild({ platform, profile: nativeChannel(environment), runtimeVersion });
        if (Option.isSome(existing)) {
          yield* Effect.log(`${platform}: build ${existing.value.id} (${existing.value.status}) already runs runtime ${runtimeVersion}`);
        } else {
          const started = yield* Eas.startBuild({ platform, profile: nativeChannel(environment), message });
          yield* Effect.log(`${platform}: no build runs runtime ${runtimeVersion}, so started build ${started.id}`);
        }
      }
    }

    if (Option.isSome(config.domain) && platforms.length > 0 && Option.isSome(appConfig)) {
      yield* this.writeAppSiteFiles({ config, appConfig: appConfig.value, exportDir: webExportDir(environment) });
    }

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
    const expected = Option.isSome(config.domain) && plan.value.promotion._tag === "Production"
      ? productionExpoAppUrl(config.web.subdomain)
      : plan.value.url;
    if (new URL(deployment.url).href !== new URL(expected).href) {
      return yield* Effect.fail(`EAS served deployment ${deployment.identifier} at ${deployment.url}, but deploy:plan announced ${expected}`);
    }
    yield* Effect.log(`Deployed ${deployment.identifier}; ${environment} is live at ${expected}`);

    if (Option.isSome(config.domain) && plan.value.promotion._tag === "Production" && Option.isSome(appConfig)) {
      const projectId = yield* this.projectId(appConfig.value);
      const report = describeCustomDomain(yield* this.dependencies.CustomDomains.ensure({ projectId, hostname: config.domain.value }));
      yield* (report.ready ? Effect.log(report.text) : Effect.logWarning(report.text));
    }

    if (environment === PREVIEW_ENVIRONMENT) {
      if (platforms.length > 0) yield* Effect.log("Previews deploy the web app only; native apps update from branch deploys");
      return;
    }
    if (!updatesNativeApps) return;
    const channel = nativeChannel(environment);
    for (const platform of platforms) {
      yield* Eas.publishUpdate({ platform, channel, easEnvironment: settings.value.easEnvironment, message, variables: settings.value.variables });
      yield* Effect.log(`${platform}: published an update to channel ${channel}`);
    }
  }

  /**
   * Writes the association files the custom domain must serve for each native app into the web export about
   * to be uploaded. One whose signing identity EAS does not hold yet is left out with a warning: iOS has no
   * team ID until its credentials are set up, and Android no keystore before its first build.
   */
  private *writeAppSiteFiles(input: { readonly config: AppExpoConfig; readonly appConfig: AppConfig; readonly exportDir: string }): EffectGen<void, string> {
    const { config, appConfig, exportDir } = input;
    const credentials = this.dependencies.SigningCredentials;
    const projectId = yield* this.projectId(appConfig);
    const files: Array<{ readonly path: string; readonly content: string }> = [];

    if (config.native.platforms.includes("ios")) {
      if (Option.isNone(appConfig.iosBundleIdentifier)) return yield* Effect.fail("expo.ios.bundleIdentifier is not set; build should have stopped on this");
      const bundleIdentifier = appConfig.iosBundleIdentifier.value;
      const teamId = yield* credentials.appleTeamId({ projectId, bundleIdentifier });
      if (Option.isSome(teamId)) {
        files.push({ path: APPLE_APP_SITE_ASSOCIATION_PATH, content: renderAppleAppSiteAssociation({ appleTeamId: teamId.value, bundleIdentifier }) });
      } else {
        yield* Effect.logWarning(`ios: EAS holds no credentials for ${bundleIdentifier} yet, so this export has no ${APPLE_APP_SITE_ASSOCIATION_PATH} and universal links will not open the app until a deploy after its credentials are set up`);
      }
    }

    if (config.native.platforms.includes("android")) {
      if (Option.isNone(appConfig.androidPackage)) return yield* Effect.fail("expo.android.package is not set; build should have stopped on this");
      const packageName = appConfig.androidPackage.value;
      const sha256Fingerprints = yield* credentials.androidFingerprints({ projectId, packageName });
      if (sha256Fingerprints.length > 0) {
        files.push({ path: ASSET_LINKS_PATH, content: renderAssetLinks({ packageName, sha256Fingerprints }) });
      } else {
        yield* Effect.logWarning(`android: EAS holds no keystore for ${packageName} yet, so this export has no ${ASSET_LINKS_PATH} and App Links will not open the app until a deploy after its first build`);
      }
    }

    const fs = this.getDependency(FileSystem.FileSystem);
    for (const { path, content } of files) {
      const target = join(exportDir, path);
      yield* pipe(
        fs.makeDirectory(join(exportDir, ".well-known"), { recursive: true }),
        Effect.andThen(fs.writeFileString(target, content)),
        Effect.mapError((e) => `Cannot write ${target}: ${e.message}`),
      );
      yield* Effect.log(`Wrote ${target}`);
    }
  }

  private *projectId(appConfig: AppConfig): EffectGen<string, string> {
    if (Option.isNone(appConfig.projectId)) return yield* Effect.fail("expo.extra.eas.projectId is not set; build should have stopped on this");
    return appConfig.projectId.value;
  }
}
