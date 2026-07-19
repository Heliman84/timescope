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
  `test-workspace-legacy/` (migration), `test-workspace-multi/` (repoA/repoB shared-global) —
  each with its own pinned settings.
- Seeding: `scripts/seed_test_data.js` writes global-storage **and** `.timescope/` stores,
  deliberately duplicating a week of record IDs across them to exercise dedup (#39). Uses
  compiled `out/core/*.js`.

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

- `develop` = integration (default PR base); `main` = releases; `feature/issue-<N>-<slug>`;
  wave sub-branches `feature/issue-<N>-<slug>--<track>` (see delegate skill).
- Versioning (`coding_standards.md:56-61`): pre-1.0, major pinned at 0; **every PR bumps
  `package.json` version in its own commit — with explicit user confirmation, never silently.**

## Directory conventions

`out/` compiled+copied, packaged into the vsix · `src/test/` pure-Node suite ·
`tests/webview/` Playwright (+ `vendor/` offline Chart.js/datalabels) · `scripts/` one-off
migration/validation utilities · `docs/dev-log/`, `docs/arc-log/` decision records.
