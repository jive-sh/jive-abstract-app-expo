Output eas-cli 25.3.0 printed against a real EAS project (`@jive-sh/jive-abstract-app-expo-fixture`) on
2026-10-26, replayed by `impl.test.ts` so the tests check this module against what EAS actually prints
without deploying anything. Re-record these when upgrading eas-cli.

- `deploy-alias.json`: stdout of `eas deploy:alias --id repro-alias-1 --alias staging --json`, the same
  shape `eas deploy --json` prints.
- `deploy-existing.stderr.txt`: stderr of `eas deploy --id repro-alias-1 ...` when that deployment already
  exists (exit code 1, empty stdout).
- `build-list-in-progress.json`, `build-list-empty.json`: stdout of `eas build:list --json` with one build
  in progress, and with none.
