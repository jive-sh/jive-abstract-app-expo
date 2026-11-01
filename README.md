# jive-abstract-app-expo

A [Jive](https://github.com/jive-sh/jive) abstract for [Expo](https://expo.dev) apps. An Expo app whose
`package.json` extends it gets a full CI/CD pipeline with no pipeline code of its own:

- **Web**: every environment is exported with its own variables and deployed to
  [EAS Hosting](https://docs.expo.dev/eas/hosting/introduction/). Pull requests get a preview deployment of
  their own.
- **Android and iOS**: every environment is a build profile and an update channel. A deploy starts an
  [EAS Build](https://docs.expo.dev/build/introduction/) only when no build exists for the app's runtime
  version, then publishes the code as an [EAS Update](https://docs.expo.dev/eas-update/introduction/) to that
  environment's channel.
- **Domain**: with `domain` set, the production deploy registers it on the EAS project and
  prints the DNS records it needs. With native platforms on, the domain also opens the Android and iOS apps:
  the build configures App Links and universal links, and every web export serves the files that prove the
  domain belongs to the apps. The app's own code and Expo config hold no linking setup.

Its CLI is `jive-app-expo`, so the target command for a new app is `jive create app-expo`.

## Vocabulary

- **Environment**: a deploy target named in `jive.cicd.deploy.branches`, such as `Staging` or `Production`.
  Jive's pipeline runs `jive:cicd:deploy` once per environment (see
  [the CI/CD contract](https://github.com/jive-sh/jive/blob/main/CICD_API.md)). A pull request deploys the
  environment `Preview`.
- **Subdomain**: the EAS Hosting *preview subdomain name*. Production is served at
  `https://<subdomain>.expo.app`. EAS reserves it on the first deploy and it can never be reused
  ([deployments and aliases](https://docs.expo.dev/eas/hosting/deployments-and-aliases/#preview-subdomain-name)).
- **Alias**: a name pointing at the newest deployment of an environment, served at
  `https://<subdomain>--<alias>.expo.app`.
- **Runtime version**: what an installed app and an update must agree on for the update to run
  ([runtime versions](https://docs.expo.dev/eas-update/runtime-versions/)).

## Extending it

```jsonc
{
  "$schema": "./package.schema.json",
  "name": "my-app",
  "version": "1.0.0",
  "license": "MIT",
  "scripts": {
    "jive:cicd:get-config": "jive-app-expo cicd get-config",
    "jive:cicd:build": "jive-app-expo cicd build",
    "jive:cicd:audit": "jive-app-expo cicd audit",
    "jive:cicd:deploy:plan": "jive-app-expo cicd deploy-plan",
    "jive:cicd:upload-artifacts": "jive-app-expo cicd upload-artifacts",
    "jive:cicd:deploy": "jive-app-expo cicd deploy",
    "dev": "jive-app-expo dev"
  },
  "dependencies": { "expo": "~58.0.19" },
  "devDependencies": { "eas-cli": "^25.3.0", "jive-abstract-app-expo": "^0.3.0" },
  "jive": {
    "cicd": {
      "deploy": { "verb": "Deploy to", "branches": { "main": ["Staging", "Production"] }, "previews": true, "sequentially": true },
      "runsOnPullRequests": true,
      "runsOn": "ubuntu-latest",
      "requiredSecrets": ["EXPO_TOKEN"]
    },
    "app-expo": {
      "web": { "subdomain": "my-app" },
      "domain": null,
      "native": { "platforms": ["android"], "distribution": "internal" },
      "environments": {
        "Staging": {
          "web": { "alias": "staging" },
          "easEnvironment": "preview",
          "variables": { "EXPO_PUBLIC_SERVER_URL": "https://staging-api.example.com" }
        },
        "Production": {
          "web": "production",
          "easEnvironment": "production",
          "variables": { "EXPO_PUBLIC_SERVER_URL": "https://api.example.com" }
        }
      },
      "preview": { "easEnvironment": "preview", "variables": { "EXPO_PUBLIC_SERVER_URL": "https://staging-api.example.com" } }
    }
  }
}
```

Every field is required, so the schema shows everything you can configure. `jive-app-expo dev` keeps
`package.schema.json` current, so your editor checks the block as you type it. The hooks also enforce rules
that span fields:

- Every environment in `cicd.deploy.branches` has an entry in `environments`, and every entry is deployed by
  some branch.
- `preview` is set exactly when `cicd.deploy.previews` is true.
- At most one environment is `"production"`, and no two environments share an alias.
- `domain` is null or a bare lowercase hostname (`app.example.com`, never `https://…`), and when set
  one environment is `"production"`, since that is the deployment the domain serves.
- `cicd.requiredSecrets` includes `EXPO_TOKEN`, because the pipeline passes the hooks only the secrets
  listed there.
- With native platforms on, each environment's name in lowercase is a valid EAS Update channel, and no two
  environments share one.
- `variables` holds only `EXPO_PUBLIC_` names, the only ones Expo inlines into the app
  ([environment variables](https://docs.expo.dev/guides/environment-variables/)). They ship inside the app,
  so they are never secrets.

The app's own Expo config (`app.json` or `app.config.*`) must also:

- Name its EAS project in `expo.owner` and `expo.extra.eas.projectId`, which `eas init --account <account>`
  writes once. EAS CLI refuses to run with a token otherwise
  ([programmatic access](https://docs.expo.dev/accounts/programmatic-access/#access-tokens-usage)).
- For native platforms, set `expo.runtimeVersion` to `{"policy": "appVersion"}` or a literal,
  `expo.updates.url` to `https://u.expo.dev/<projectId>`, and `expo.android.package` and/or
  `expo.ios.bundleIdentifier`.
- With a domain and native platforms, have no `app.config.*` of its own: the build generates
  `app.config.cjs`, and Expo reads only one dynamic config. Keep `app.config.cjs` out of `.gitignore` too (it
  must reach EAS Build, which uploads only files git doesn't ignore) and out of commits (every build rewrites it).

`build` checks all of these, so a pull request fails on a missing setting before anything merges.

The app's repository needs one secret, `EXPO_TOKEN`: an Expo access token for the account that owns the
EAS project, which EAS CLI reads from the environment
([access tokens](https://docs.expo.dev/accounts/programmatic-access/)). A robot user with the Developer
role is enough to create the project with `eas init` and to deploy, though not to set the project's icon
(checked with eas-cli 25.3.0).

## What each hook does

| Hook | Behavior |
| --- | --- |
| `get-config` | Prints the validated `jive` block as JSON. |
| `build` | Writes `app.config.cjs` when a domain and native platforms are set (and removes one an earlier build wrote otherwise), checks `package.json` and the Expo config, writes `eas.json` when native platforms are on, and runs `expo export --platform web` once per environment into `dist/web/<environment>`, with that environment's variables. It never contacts EAS. |
| `audit` | Checks every environment has a web export. Replace this script to run the app's own tests. |
| `deploy:plan` | Plans a deploy (`{"deploy":true,"url":…}`) to the environment's web URL, derived from configuration alone (table below). |
| `upload-artifacts` | Nothing; the pipeline's artifact already carries `dist/`. |
| `deploy` | In order: for each native platform, runs `eas build` if no build of the environment's profile exists for the runtime version; with a domain, writes the domain's `.well-known` files into the export; runs `eas deploy` for the export and fails if EAS reports a URL other than the one `deploy:plan` printed; for production with a domain, registers it on the EAS project and reports its DNS records; last, runs `eas update` to the environment's channel for each native platform, bundling into `dist/eas-update` so the other environments' web exports survive. Previews skip the native steps. |

Where each environment's web app is served:

| Environment config | `eas deploy` flag | URL |
| --- | --- | --- |
| `"web": "production"` | `--prod` | `https://<subdomain>.expo.app/`, or `https://<domain>/` when one is set (it answers once its DNS records are in place) |
| `"web": { "alias": "staging" }` | `--alias staging` | `https://<subdomain>--staging.expo.app/` |
| `Preview` (pull request 42 at commit `1a2b3c4d…`) | `--id pr-42-1a2b3c4d` | `https://<subdomain>--pr-42-1a2b3c4d.expo.app/` |

Every deployment also gets an id made of its kind and commit (`production-1a2b3c4d`,
`alias-staging-1a2b3c4d`), so it stays reachable at `https://<subdomain>--<id>.expo.app/` after the alias
moves on. Deployments are immutable, so a rerun of the same commit finds its deployment already there; the
hook then points the alias or production at it again. Rerunning an older commit's deploy therefore rolls
back to it.

A preview is a deployment with its own id rather than an alias. Nothing needs cleaning up when the pull request
closes, and previews don't use up aliases, which EAS caps per plan (5 on Free,
[pricing](https://expo.dev/pricing)).

`eas.json` is generated from `package.json` on every build: one profile per environment, the profile and
its `channel` both the environment's name in lowercase (EAS rejects capitals in channel names). Keep it out
of git.

## Domain and universal links

Set `"domain": "app.example.com"` and nothing else. With `"domain": null` none of this runs. EAS calls a domain
registered on a project a custom domain; that is what the deploy registers.

**Registering the domain.** Each production deploy reads the EAS project's custom domain through Expo's
GraphQL API and registers `domain` only if it is missing. EAS holds one per project, so a different
hostname registered there (by the dashboard or an earlier `domain`) is removed first. An already
registered domain is only checked again. Then the deploy log lists every DNS record the domain needs, whether
EAS found each one, and EAS's verification and SSL status:

```text
Custom domain app.example.com: registered on the EAS project by this deploy.
  Status: setup PENDING, ownership verification PENDING, SSL certificate not reported.
  DNS records it needs at its DNS provider (1 of 2 not found yet; this deploy does not create them):
    [found  ] CNAME app.example.com -> my-app.expo.app  (routing)
    [missing] TXT   _cf-custom-hostname.app.example.com -> …  (ownership verification)
  https://app.example.com/ serves production once every record is found and the status is ACTIVE; the next deploy checks again.
```

Creating the records is yours, at your DNS provider. A missing record logs a warning and the deploy still
succeeds, since the records can only be created after the first deploy prints them; each later deploy reports
the status again. Custom domains need a paid EAS plan ([pricing](https://expo.dev/pricing)); on a free plan
the production deploy fails with EAS's refusal and that requirement. Setting `domain` back to null leaves
the registered domain in place.

**Universal links and App Links.** With native platforms on, `build` writes `app.config.cjs`. Expo evaluates
it over your `app.json` and appends, for each platform built:

- iOS: `ios.associatedDomains: ["applinks:app.example.com"]`
  ([iOS universal links](https://docs.expo.dev/linking/ios-universal-links/)).
- Android: an `intentFilters` entry with `action: "VIEW"`, `autoVerify: true`, `data: [{ scheme: "https",
  host: "app.example.com" }]` and `category: ["BROWSABLE", "DEFAULT"]`
  ([Android App Links](https://docs.expo.dev/linking/android-app-links/)).

Entries your config already has are kept, and none is added twice. Every deploy then writes into the web
export it uploads, so the domain serves them:

- `/.well-known/apple-app-site-association`, whose `applinks.details[0].appID` is `<team ID>.<bundle ID>`
  for all paths (`"*"`).
- `/.well-known/assetlinks.json`, one statement for `expo.android.package` with two relations,
  `delegate_permission/common.handle_all_urls` (App Links) and `delegate_permission/common.get_login_creds` (the app
  uses the domain's passkeys and passwords through Credential Manager), listing the SHA-256 fingerprint of every
  keystore EAS holds for it.

The team ID and fingerprints come from EAS's credentials service, read through Expo's GraphQL API with the
same token (the `iosAppCredentials` and `androidAppCredentials` queries `eas credentials` runs; only the
fingerprint and team ID are requested, never a keystore or password). Native builds start before the web
upload, because a project's first `eas build` generates its Android keystore. So the first release already
carries the fingerprint. A file whose identity EAS doesn't hold yet is left out with a warning: iOS has no
team ID until its credentials are set up, and an Android keystore appears with the first build.

## Limitations and open questions

- **Previews deploy the web app only.** A native preview would need a build listening on a per-pull-request
  channel, which costs a build per pull request.
- **The domain belongs to the app, not to an environment.** `domain` is set once and always
  serves production; the other environments stay on `expo.app` aliases. EAS's registration accepts an alias
  name, so per-environment domains are possible later, but the manifest has no field for them.
- **DNS records are not created.** The deploy prints them; creating them waits on a DNS connector.
- **The custom domain API is undocumented.** Expo documents only the dashboard
  ([custom domain](https://docs.expo.dev/eas/hosting/custom-domain/)); this abstract calls the mutations
  the dashboard uses, all of them in `src/internal/modules/custom-domains`, so a change on Expo's side is
  fixed there.
- **Store builds signed by Google Play.** With Play App Signing, Play re-signs the app with its own key, whose
  fingerprint EAS doesn't hold, so App Links from a Play install don't verify until that fingerprint is in
  `assetlinks.json`, which nothing adds yet. Internal builds are signed with the EAS keystore and verify.
- **iOS needs an Apple Developer Program membership** linked to the EAS project, because EAS generates the
  signing credentials with it ([managed credentials](https://docs.expo.dev/app-signing/managed-credentials/)).
  Android needs nothing beyond the token: in non-interactive mode EAS generates the keystore itself.
- **Submitting to the stores is not automated.** `"distribution": "store"` builds store binaries; submitting
  them needs Google Play and App Store Connect access.
- **The `fingerprint` runtime version policy is not supported.** The hooks must know the runtime version
  without a native build, which a literal or `appVersion` allows.

## How it is tested

This repository is a library: its own pipeline publishes it to npm and never deploys to Expo. `bun run
jive:cicd:audit` runs every check: `tsc`, the unit tests, then the hook tests on the fixture. Its tests run
everything up to the point of contacting EAS:

- Unit tests (`src/**/*.test.ts`) cover the manifest rules, URL and id derivation, the generated `eas.json`
  and `app.config.cjs` (evaluated the way Expo calls it), the `.well-known` files, the deploy sequence against
  fake modules, the EAS module against `eas` CLI output recorded from a real project
  (`src/internal/modules/eas/recorded/`), the GraphQL client against a fake HTTP client, and the custom domain
  and credentials modules against a fake Expo API answering in the shapes of eas-cli 25.3.0's generated GraphQL
  types.
- `test/hooks.test.ts` runs `get-config`, `build`, `audit` and `deploy:plan` against the fixture app in
  `test/fixture`, and checks each environment's bundle carries only its own variables. It also writes the
  config `build` generates for a domain and checks, with the fixture's own Expo CLI
  (`expo config --type introspect`), that the Android manifest gets the verified intent filter and the iOS
  entitlements the associated domain. The fixture keeps `domain: null`, because it is linked to a real
  EAS project.

What only an app's own pipeline can test, against its real EAS project: that EAS accepts the token and
serves each deployment at the predicted URL, the first production promotion, the native build itself, and
the installed app picking up the update. Also untested live: the custom domain mutations' real responses
and their refusal on a free plan, whether a Developer-role token may register a domain and read credentials,
the format EAS stores fingerprints in (normalized to `AA:BB:…` either way), and whether EAS Build turns on
the Associated Domains capability on the Apple App ID from the entitlement in a pipeline that is not signed
in to Apple ([iOS capabilities](https://docs.expo.dev/build-reference/ios-capabilities/)). One observation from the run that recorded the outputs: a freshly
created alias once answered 404 a minute after `eas deploy` reported it assigned, and served normally when
the same deploy was repeated; the cause is unknown.

