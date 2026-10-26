import { Data, Option } from "effect";
import type { PipelineContext } from "jive-abstract-library";
import { PREVIEW_ENVIRONMENT, type AppExpoConfig } from "../public/manifest";

/**
 * How one environment's web app is published on EAS Hosting, and the URL it is then served at.
 *
 * `deploy:url` must print the URL before anything is deployed, and `deploy` must publish to exactly that URL,
 * so both derive it here from configuration and the pipeline context alone. EAS Hosting makes that possible:
 * a deployment is reachable at `https://<subdomain>--<id>.expo.app` for an id the deployer chooses, at
 * `https://<subdomain>--<alias>.expo.app` once given an alias, and at `https://<subdomain>.expo.app` (and the
 * custom domain) once promoted to production
 * (https://docs.expo.dev/eas/hosting/deployments-and-aliases/#terminology).
 */
export type Promotion = Data.TaggedEnum<{
  /** `eas deploy --prod`. */
  Production: {};
  /** `eas deploy --alias <alias>`. */
  Alias: { readonly alias: string };
  /**
   * No alias. Previews use this so a pull request leaves nothing to clean up: aliases are limited per plan
   * (5 on Free) and the pipeline has no hook for a closed pull request, while unaliased preview deployments
   * expire on their own (https://expo.dev/pricing).
   */
  None: {};
}>;
export const Promotion = Data.taggedEnum<Promotion>();

export interface WebDeploymentPlan {
  /**
   * `eas deploy --id`: one per environment and commit (`alias-staging-1a2b3c4d`), so every deployment is
   * traceable to the commit that produced it and stays reachable at its own URL after the alias moves on.
   * Each kind has its own first word (`production`, `alias`, `pr`, `branch`), so no two environments or
   * commits share an id.
   */
  readonly id: string;
  readonly promotion: Promotion;
  /** Where the environment is served once the deployment is promoted. */
  readonly url: string;
}

/** Longest DNS label; the deployment's whole `<subdomain>--<id>` host label must fit in it. */
const MAX_LABEL_LENGTH = 63;
const SHORT_SHA_LENGTH = 8;

function toDnsLabelWords(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** `<source>-<sha8>`, with `source` cut so `<subdomain>--<id>` fits in one DNS label. */
export function deploymentId(input: { readonly source: string; readonly context: PipelineContext; readonly subdomain: string }): string {
  const sha = input.context.sourceCommitSha.slice(0, SHORT_SHA_LENGTH).toLowerCase();
  const room = MAX_LABEL_LENGTH - `${input.subdomain}--`.length - `-${sha}`.length;
  const source = input.source.slice(0, Math.max(room, 1)).replace(/-+$/, "");
  return `${source}-${sha}`;
}

function expoAppUrl(label: string): string {
  return `https://${label}.expo.app/`;
}

/** How one environment is deployed and where it is served, or None for one this package does not configure. */
export function planWebDeployment(input: {
  readonly config: AppExpoConfig;
  readonly environment: string;
  readonly context: PipelineContext;
}): Option.Option<WebDeploymentPlan> {
  const { config, environment, context } = input;
  const { subdomain, customDomain } = config.web;
  const id = (source: string) => deploymentId({ source, context, subdomain });

  if (environment === PREVIEW_ENVIRONMENT) {
    if (Option.isNone(config.preview)) return Option.none();
    const previewId = id(context.event.type === "PULL_REQUEST"
      ? `pr-${toDnsLabelWords(context.event.id)}`
      : `branch-${toDnsLabelWords(context.sourceBranch)}`);
    return Option.some({ id: previewId, promotion: Promotion.None(), url: expoAppUrl(`${subdomain}--${previewId}`) });
  }

  const configured = config.environments[environment];
  if (configured === undefined) return Option.none();
  if (configured.web === "production") {
    return Option.some({
      id: id("production"),
      promotion: Promotion.Production(),
      url: Option.isSome(customDomain) ? `https://${customDomain.value}/` : expoAppUrl(subdomain),
    });
  }
  const { alias } = configured.web;
  return Option.some({ id: id(`alias-${alias}`), promotion: Promotion.Alias({ alias }), url: expoAppUrl(`${subdomain}--${alias}`) });
}

export interface EnvironmentSettings {
  readonly easEnvironment: string;
  readonly variables: Readonly<Record<string, string>>;
}

/** Every environment this package can deploy, with its settings: the configured ones, then Preview when on. */
export function deployableEnvironments(config: AppExpoConfig): ReadonlyArray<{ readonly name: string; readonly settings: EnvironmentSettings }> {
  return [
    ...Object.entries(config.environments).map(([name, settings]) => ({ name, settings })),
    ...Option.toArray(Option.map(config.preview, (settings) => ({ name: PREVIEW_ENVIRONMENT, settings }))),
  ];
}

/** The variables and EAS environment one environment builds with, or None for one this package lacks. */
export function environmentSettings(config: AppExpoConfig, environment: string): Option.Option<EnvironmentSettings> {
  return Option.fromNullishOr(deployableEnvironments(config).find(({ name }) => name === environment)?.settings);
}
