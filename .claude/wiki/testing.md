# testing.md — How Tests Work

> *What this is: the two test suites' patterns, harness mechanics, and exactly how to add a test to each.*


## Pure-Node suite (`src/test/`)

- `run_tests.ts` `main()` (:21) calls every `run_*_tests()` in sequence in a try/catch;
  exit 0/1. **Tests are plain throwing functions** — Node `assert`, `console.log("  ✓ …")`
  on success; any throw fails the whole run. No framework.
- **To add a test:** write `run_xxx_tests(): void` in a `src/test/test_xxx.ts`, log a
  checkmark per case, then import + call it in `run_tests.ts`.
- Filesystem tests isolate under `test-output/<suite>-<suffix>-<timestamp>` (see
  `test_migration.ts:9` `mkdir_tmp`) — never touch real global storage.
- Coverage: event repository (append/load/rename/validation/dedup/replication), session,
  event collection, jobs, dashboard utils (`buildPayload`/`filterRelevantErrors`/edit
  round-trip), event domain, build info, storage-dir resolution, `filter_state`, log hygiene
  (sanitize/append-safe/write-atomic/compaction), repo_config, repo_jobs, registry,
  local_opt_in, global_index, migration.


## Playwright webview suite (`tests/webview/`)

- Config `playwright.config.ts`: `testDir: tests/webview`, 30 s timeout, fullyParallel,
  headless. **Offline by construction.**
- `harness.ts` serves the **real** `src/dashboard/webview/*` files by `page.route`
  interception on a fake `https://timescope.test/` origin (no dev server): `open_dashboard()`
  (:45) strips CSP/nonce, substitutes asset placeholders, routes Chart.js/datalabels CDN URLs
  to `tests/webview/vendor/*.js`.
- `acquireVsCodeApi()` is stubbed via `page.addInitScript` (:85-113): `postMessage` records
  into `window.__posted`; a `request_data` auto-replies `summary_data` with the fixture
  payload; inject more via `reply()` / `window.__reply(msg)`.
- Clock frozen: `page.clock.setFixedTime(FIXED_NOW)`, `FIXED_NOW = 2026-07-15T12:00` local
  (`fixtures.ts:31`) — date-preset filters are deterministic.
- Fixtures (`fixtures.ts`) mirror `buildPayload` exactly (`event, job, timestamp, task, id,
  job_id, time_seed, global_line_index, workspace_line_index`). Builders: `build_fixture`
  (3 sessions — edit modal/highlighting/build info), `build_filter_fixture` (12 jobs on
  preset boundaries — filter/sort), `build_malformed_fixture` (Dangle/Orphan/Skip/Ghost/
  Twice — malformed-stream spec).
- **To add a webview test:** import fixtures + `open_dashboard`/`reply`/`posted_messages`
  from `harness.ts`; `open_dashboard(page, fx.payload)` in `test.beforeEach`; assert on DOM
  or `Chart.getChart(id)`. Specs: `dashboard.spec.ts`, `filtering.spec.ts`,
  `malformed_streams.spec.ts`.


## F5 fixture workspaces (fixed identities — never repurpose one for another's job)

Each workspace answers **one specific question**. Its identity is stable — pick the workspace
whose identity matches the scenario, and **never mutate a workspace out of its role** to fake
another's state.

| Workspace | The question it answers |
| :--- | :--- |
| `test-workspace` | **"Where are we right now."** Current file formats, a repo that's been tracking for a while — does today's build keep working / upgrade in place? The steady-state continuity baseline. |
| `test-workspace-legacy` | **"Will a real upgrade work?"** A last-release install (specifically **v0.2.0**: log-only repo, no `config.json`) opened by today's build. |
| `test-workspace-empty` | **"Clean-slate init."** No `.timescope` — does first-run / opt-in initialize correctly from nothing? |
| `test-workspace-multi` | **"Parallel windows."** `repoA` + `repoB` + `shared-global` — multiple VS Code windows working at once without interfering. |

**The rule:** if a feature needs an empty slate, send the tester to `test-workspace-empty` —
**do not empty `test-workspace`**. If it needs the legacy path, use `test-workspace-legacy` — do
not strip a config to fake it. When the tester opens the workspace they expect and finds it in an
unanticipated state, it reads as a bug and burns their time figuring out what's wrong. The F5
receipt's `--workspace` must name the workspace whose identity matches the test.


## Coverage gaps (by design — the F5 layer)

- No live VS Code host in either suite: activation, status bar rendering, QuickPicks, and
  recovery UI are manual-F5 only (`DEVELOPMENT.md:100`).
- The Playwright suite covers the dashboard's own JS; the extension-side message router
  (`dashboard.ts`) is covered by the Node suite's `test_dashboard.ts` against the repository
  layer instead.
- These gaps are exactly what the F5 packet's steps must exercise.
