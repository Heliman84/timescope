# Changelog

One line per merged PR, added at PR time under **Unreleased**. At release, entries move under the new version heading and become the GitHub Release notes.


## Unreleased

- Multi-instance safety: every `registry.json` write now goes through an intent-based read-modify-write (reload fresh, apply the change, atomic write) so concurrent windows no longer clobber each other's registrations or resurrect removed opt-out declines, the first-opt-in `config.json` race is closed via content-atomic exclusive create + loser adopts the winner's `repo_id`, and a second VS Code window opened on an already-tracked repo is detected via a per-repo heartbeat lock and warned instead of silently racing timer actions and crash-recovery; regression coverage added as a multi-instance verification matrix (#47)
- Dev process hardening: the arc/agent guardrails are now **enforced, not advisory** — a project `model: opus` default plus four fail-open Node hooks in `.claude/hooks/` (`SessionStart` role/model check that flags a Fable/non-opus main window; `PreToolUse` branch guard denying source edits on `develop`/`main`; `Stop` F5-staging gate that blocks a handoff without a fresh `.claude/.f5-ready.json` receipt; `Stop` dev-log gate that blocks a turn announcing a PR URL while the dev-log still shows `PR: TBD`). The verifier now owns F5 fixture staging + the receipt, the feature loop's scope step is a hard STOP, and satellite starter-prompt rules cast the chat as an orchestrator that never inherits pre-baked scope (#60)
- Dev process: agent-driven delegation — eight model/effort-pinned project agents (`.claude/agents/`), a curated agent wiki (`.claude/wiki/`), a `delegate` skill (delegation tiers, parallel worktree waves with sub-branch PRs, F5 packet assembly), CLAUDE.md policy, and process docs including a portable foundation for other repos ([docs/agent-process.md](docs/agent-process.md)) (#56)
- Local-first storage, phase 48a (foundation for #48): TimeScope no longer creates a `.timescope` folder speculatively — the first Start in an un-opted-in workspace offers to log locally, and only then is `.timescope/` created with a committed `config.json` (a stable repo id); an existing `.timescope` directory is treated as already opted-in. A global `registry.json` now tracks known repos for the upcoming derived index. Adds an isolated `test-workspace-empty/` F5 fixture for exercising the opt-in prompt. Fixes #2. (#48)
- Local-first storage, phase 48b (for #48): each tracked event is now also replicated into a derived global `index.jsonl` (de-duplicated by id), and non-workspace (off-project) sessions into an owned `scratch.jsonl`; a new **TimeScope: Rebuild Global Index** command reconstructs the index from the owned sources (registered repo logs + scratch). Additive only — the existing global/workspace dual-write and merged dashboard read are unchanged, de-risking the 48c cutover. (#48)
- Local-first storage (US-06, for #48): a repo's jobs are now cached in its committed `.timescope/config.json` and unioned into the Start picker, so opening an existing/cloned repo (even on a machine with an empty global job list) shows its jobs without re-typing. Older log-only repos auto-upgrade — jobs are derived from the log and written into `config.json` on open (config bumped to v2, additive). (#48)
- Local-first storage (for #48): new **TimeScope: Show Storage Status** command — an on-demand view of the derived index / scratch counts, whether a legacy log is pending migration (+ backup), registered repos & declined folders, and this repo's cached jobs. Migration no longer depends on a fleeting activation toast. (#48)
- Local-first storage (for #48): the per-folder opt-out ("Never for this folder") now persists in the global `registry.json` (a `declined[]` list) instead of VS Code's per-window state — one inspectable machine-local store for both known repos and declines (rule: travels → repo; machine-local → registry). Underlying `decline`/`undecline` functions ship now; the reversal UI is #6. (#48)
- Local-first storage, phase 48c — cutover (for #48): TimeScope is now fully local-first with **one owner per event** — an opted-in repo's `.timescope/logs.jsonl` owns its events, off-project sessions are owned by the global `scratch.jsonl`, and the old global dual-write is gone. The dashboard reads the derived, rebuildable `index.jsonl`. On first launch the legacy global `logs.jsonl` is migrated into scratch (backed up to `logs.jsonl.migrated.bak` first, deduped, then retired). Editing targets the owning log; editing events owned by other repos is deferred to #43. (#48)

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
