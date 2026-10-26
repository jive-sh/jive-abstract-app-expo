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
    "jive:cicd:deploy:url": "jive-app-expo cicd deploy-url",
    "jive:cicd:upload-artifacts": "jive-app-expo cicd upload-artifacts",
    "jive:cicd:deploy": "jive-app-expo cicd deploy",
    "dev": "jive-app-expo dev"
  },
  "dependencies": { "expo": "~58.0.19" },
  "devDependencies": { "eas-cli": "^25.3.0", "jive-abstract-app-expo": "^0.1.0" },
  "jive": {
    "cicd": {
      "deploy": { "verb": "Deploy to", "branches": { "main": ["Staging", "Production"] }, "previews": true, "sequentially": true },
      "runsOnPullRequests": true,
      "runsOn": "ubuntu-latest",
      "requiredSecrets": ["EXPO_TOKEN"]
    },
    "app-expo": {
      "web": { "subdomain": "my-app", "customDomain": null },
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

`build` checks all of these, so a pull request fails on a missing setting before anything merges.

The pipeline needs one secret, `EXPO_TOKEN`: an Expo access token that EAS CLI reads from the environment
([access tokens](https://docs.expo.dev/accounts/programmatic-access/)).

## What each hook does

| Hook | Behavior |
| --- | --- |
| `get-config` | Prints the validated `jive` block as JSON. |
| `build` | Checks `package.json` and the Expo config, writes `eas.json` when native platforms are on, and runs `expo export --platform web` once per environment into `dist/web/<environment>`, with that environment's variables. |
| `audit` | Checks every environment has a web export. Replace this script to run the app's own tests. |
| `deploy:url` | Prints the environment's web URL, derived from configuration alone (table below). |
| `upload-artifacts` | Nothing; the pipeline's artifact already carries `dist/`. |
| `deploy` | Runs `eas deploy` for the environment's export, then fails if EAS reports a URL other than the one `deploy:url` printed. For each native platform it then runs `eas build` if no build of that profile exists for the runtime version, and `eas update` to the environment's channel. |

Where each environment's web app is served:

| Environment config | `eas deploy` flag | URL |
| --- | --- | --- |
| `"web": "production"` | `--prod` | `https://<subdomain>.expo.app/`, or `https://<customDomain>/` once set |
| `"web": { "alias": "staging" }` | `--alias staging` | `https://<subdomain>--staging.expo.app/` |
| `Preview` (pull request 42 at commit `1a2b3c4d…`) | `--id pr-42-1a2b3c4d` | `https://<subdomain>--pr-42-1a2b3c4d.expo.app/` |

A preview is a deployment with its own id rather than an alias. Nothing needs cleaning up when the pull request
closes, and previews don't use up aliases, which EAS caps per plan (5 on Free,
[pricing](https://expo.dev/pricing)).

`eas.json` is generated from `package.json` on every build, one profile per environment, with
`channel` and the profile named after the environment. Keep it out of git.

## Limitations and open questions

- **Previews deploy the web app only.** A native preview would need a build listening on a per-pull-request
  channel, which costs a build per pull request.
- **Custom domains are assigned in the EAS dashboard.** Assigning one, and its three DNS records, is a
  dashboard step on a paid plan ([custom domain](https://docs.expo.dev/eas/hosting/custom-domain/)).
  `customDomain` only changes the URL `deploy:url` reports.
- **iOS needs an Apple Developer Program membership** linked to the EAS project, because EAS generates the
  signing credentials with it ([managed credentials](https://docs.expo.dev/app-signing/managed-credentials/)).
  Android needs nothing beyond the token: in non-interactive mode EAS generates the keystore itself.
- **Submitting to the stores is not automated.** `"distribution": "store"` builds store binaries; submitting
  them needs Google Play and App Store Connect access.
- **The `fingerprint` runtime version policy is not supported.** The hooks must know the runtime version
  without a native build, which a literal or `appVersion` allows.
