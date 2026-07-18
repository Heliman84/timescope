# Changelog

One line per merged PR, added at PR time under **Unreleased**. At release, entries move under the new version heading and become the GitHub Release notes.


## Unreleased

- Playwright coverage pinning how the dashboard renders malformed/unbalanced event streams (dangling start, unresumed pause, orphan resume, stop-without-start, double start) — production reality per the real log's 145/122 pause/resume imbalance (#42)
- Docs: introduce `docs/arc-log/` for multi-issue development arcs (spine above the per-issue dev-logs); first entry documents the local-first storage re-architecture (#42, #48)
- Log hygiene: newline-safe appends (concatenated-record bug class closed), load-time sanitizer that heals glued records in memory and reports damage, atomic temp-file+rename for all full-file rewrites, and a **TimeScope: Compact Log** command (`.bak` first, idempotent) offered via prompt when disk damage is found; `npm run seed-testdata -- --damaged` seeds a damaged log for F5 testing (#42)
- Summary view redesign: sidebar replaced by integrated filtering — date presets (default Last 14 Days, now actually applied) with native start/end date pickers, a checkbox job legend synced with a table job dropdown, inclusive duration and pause/resume range filters, sortable columns, an explicit empty state, and a validated colorblind-safe chart palette; all filters drive the charts and table together (#5)
- `npm run seed-testdata`: also seeds a workspace-local `.timescope/` store (last week of global events re-emitted with identical IDs + a few unique events under a "Local Client" job) so F5 exercises the cross-file dedup/merge path (#39)
- `timescope.global_storage_dir`: a relative value now resolves against the first workspace folder (absolute values unchanged), so the isolated F5 test-storage setting is portable across clones and machines (#33)
- Dev logs: each feature branch keeps a short decision log in `docs/dev-log/` (started at plan time, finalized as a retrospective at PR time) — captures the *why* behind a change, not a spec (#36)
- Build info: `npm run package` writes `out/buildinfo.json`; visible via the new **TimeScope: Show Build Info** command, the status-bar tooltip, and a dashboard footer — plus a per-PR version-bump policy so the Extensions view version reflects real progress (#35)
- Claude-driven development process: three chat-driven workflow skills (feature / install / release), CLAUDE.md, PR CI, isolated F5 test storage; retired the legacy script-based workflow
- Playwright UI test suite for the dashboard webview (`npm run test:ui`): renders the real dashboard against fixture data, covering charts, filters, session table, and the edit-modal round-trip
- `npm run seed-testdata`: generate fresh multi-week F5 test data into the isolated test-workspace storage


## v0.2.0 — 2026-02-25

- Recover orphaned sessions when VS Code closes while a job is running (#9, #23)
- Dashboard: job editing and highlighting from the stacked bar chart
- Fixed lost ability to add new jobs (#27, #28)


## v0.1.0

- Initial release: start/pause/resume/stop session tracking from the status bar, jobs, summary dashboard (pie, stacked bars, session table), global + workspace JSONL storage
