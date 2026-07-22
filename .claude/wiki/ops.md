# ops.md — Operations

> *What this is: every command, fixture, and rig needed to build, test, seed, package, and F5 this repo.*


## npm scripts (`package.json:82-92`)

| Script | Does |
| :--- | :--- |
| `compile` | `tsc -p ./` → `out/` |
| `watch` | incremental compile |
| `copy-dashboard` | copies `src/dashboard/webview/*` → `out/dashboard/webview/` (webview is **copied JS, not compiled**) |
| `vscode:prepublish` | compile + copy-dashboard + write-buildinfo (auto-runs before packaging) |
| `test` | compile, then `node ./out/test/run_tests.js` — pure Node, no VS Code host |
| `test:ui` | Playwright dashboard suite (headless Chromium, offline) |
| `seed-testdata` | seeds F5 fixtures; flags `--damaged`, `--from-real [dir]`; needs compile (script handles it) |
| `write-buildinfo` | `out/buildinfo.json` `{version, commit, branch, build_date}`; git failure degrades to "unknown" |
| `package` | prepublish + `vsce package` → `timescope-<version>.vsix` (never committed) |


## F5 dev rig

- `.vscode/launch.json`: extensionHost with `--disable-extensions`, opens `test-workspace/`;
  `preLaunchTask: build-timescope` (= `vscode:prepublish`, `.vscode/tasks.json:5`).
- `test-workspace/.vscode/settings.json` pins `timescope.global_storage_dir: "global-storage"`
  (relative → `test-workspace/global-storage/`) — F5 never touches real tracking data.
- Fixture workspaces: `test-workspace/` (main), `test-workspace-empty/` (opt-in prompt),
  `test-workspace-legacy/` (migration), `test-workspace-multi/` (repoA/repoB/repoA-dup,
  shared-global) — each with its own pinned settings.
- Seeding: `scripts/seed_test_data.js` writes global-storage **and** `.timescope/` stores,
  deliberately duplicating a week of record IDs across them to exercise dedup (#39). Uses
  compiled `out/core/*.js`.

### Multi-instance rig (two real Extension Development Hosts)

A plain VS Code *New Window* from an EDH runs the **installed** TimeScope, not the dev
build (`--extensionDevelopmentPath` isn't inherited) — it silently tests the wrong version
and the instance lock never contests. A genuine two-instance test needs two EDHs, launched
either via the checked-in configs ("Run TimeScope — repoA (multi-instance)", "repoB",
"repoA-dup (same-repo double-open)") or by CLI with distinct user-data dirs:
`code --extensionDevelopmentPath=<repo> --user-data-dir=<distinctA> --disable-extensions
<repo>/test-workspace-multi/repoA` (repeat with `<distinctB>` + `repoB`). The instance lock
keys on `repo_id` from `.timescope/config.json`, not folder path — `repoA-dup` is a separate
folder sharing repoA's `repo_id` (with an open/unstopped session, to also exercise
recovery-suppression) so same-repo double-open can be staged without fighting VS Code's
"folder already open" focus behavior. Regenerate fixtures with
`node scripts/seed_multi_fixture.js` (creates repoA/repoB/repoA-dup under
`test-workspace-multi/`, all pinned to `../shared-global`).


## Tooling & CI

- Engines: vscode `^1.85.0`; TypeScript `^5.4.0`; `@playwright/test ^1.61.1`; vsce `^3.0.0`;
  CI Node 18 on ubuntu-latest.
- `tsconfig.json`: commonjs / es2020 / strict; excludes `scripts`, `tests`, `test-output`,
  `playwright.config.ts` — the Playwright suite is outside the main compile.
- CI (`.github/workflows/ci.yml`): `test` job (npm test + copy-dashboard) and `webview-tests`
  job (`playwright install --with-deps chromium`, `npm run test:ui`); PRs to develop/main.
- Pre-commit hook `.githooks/pre-commit` blocks direct commits to develop/main; enable once
  per clone: `git config core.hooksPath .githooks` (`DEVELOPMENT.md:80`).


## Branch & version discipline

- `develop` = integration (default PR base); `main` = releases; `arc/<slug>` = long-lived
  integration branch for a multi-issue arc, off develop (features nest under it, PR into it,
  merges to develop only at arc close); `feature/issue-<N>-<slug>` (off develop, or off the
  arc when one exists); wave sub-branches `feature/issue-<N><letter>--<slug>`, letter = merge
  order (delegate skill).
- Versioning (`coding_standards.md:56-61`): pre-1.0, major pinned at 0; **every PR bumps
  `package.json` version in its own commit — with explicit user confirmation, never silently.**


## Directory conventions

`out/` compiled+copied, packaged into the vsix · `src/test/` pure-Node suite ·
`tests/webview/` Playwright (+ `vendor/` offline Chart.js/datalabels) · `scripts/` one-off
migration/validation utilities · `docs/dev-log/`, `docs/arc-log/` decision records.
