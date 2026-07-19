# arch.md — TimeScope Architecture

> *What this is: where every piece of code lives and how data flows from a click to disk to the dashboard.*


## Purpose
VS Code extension tracking consulting hours: start/pause/resume/stop from the status bar,
webview analytics dashboard. Domain-driven, immutable domain objects, local-first storage
(one owner per event; global index is derived). Diagrams: `docs/processes.md`.


## Module map — `src/core/`

| File | Owns |
| :--- | :--- |
| `runtime.ts` | `Runtime` (line 17) — the **single mutable coordinator**: paths, jobs, repos, `activeSession`, ui, `_cachedCollection` (dashboard's cached derived index) |
| `event.ts` | Immutable `Event` (factories `create`/`fromDTO`/`fromJSONL` at 60/81/114); record-ID generation (`generate_record_id` :348); transition legality (`isTransitionAllowed`/`validateTransition` :249/:268) |
| `job.ts` | Immutable `Job`; identity = FNV-1a of `seedTitle` (`computeJobIdFromSeed` :194); `fromEventFields` :175 builds `partial` Jobs (never persist them) |
| `session.ts` | `Session` (:12) wraps one job's `EventCollection`; `ensureSingleSession` :51 enforces legality; `start/pause/resume/stop` :212–238 |
| `event_collection.ts` | Immutable aggregate; `validate()` :284; `validateReplacement(s)` :155/:178 (edit flow, error vs warning severities); `_detectCrossJobOverlaps` :208 (warning-only) |
| `event_repository.ts` | JSONL I/O. `appendEvent` :66 picks the one owned log (workspace if opted-in, else scratch), dedup-checks, replicates to `index.jsonl`; `appendValidated` :116 adds state-legality check; `loadIndexEntries` :156 (dashboard read), `loadAllEntries` :440 (owned/editable read) |
| `job_repository.ts` / `job_collection.ts` / `job_dto.ts` | Jobs persist to global `jobs.json` only |
| `registry.ts` / `registry_repository.ts` | Immutable `Registry` of known repos + declined folders → global `registry.json` |
| `repo_config.ts` / `repo_jobs.ts` | `.timescope/config.json` read/write; US-06 job cache (`ensure_repo_jobs_cache` :46) |
| `global_index.ts` | `rebuild_index` :39 (registry repo logs + scratch → `index.jsonl`, dedup by id); `append_owned_event` :16 |
| `migration.ts` | One-shot `migrate_legacy_global_log` :21 (legacy `logs.jsonl` → scratch, backup, dedup, delete) |
| `log_sanitizer.ts` | `sanitize_lines` :99 (in-memory healing only); `compact_log_file` :153 (on-disk repair, `.bak` first) |
| `local_opt_in.ts` | Opt-in/decline/register for `.timescope/` (`is_workspace_opted_in` :13, `enable_local_logging` :66) |
| `paths.ts` | `resolve_paths` :42 → `TimeScopePaths` (global jobs/log/registry/index/scratch + workspace paths when opted in) |
| `recovery.ts` | `checkAndRecover` :17 (crash recovery QuickPick); **`ensureAfter` :13 (monotonic timestamps)** |
| `timer.ts` | Pure status-bar/timer helpers over `Runtime` |
| `build_info.ts` | Reads `out/buildinfo.json` (`load_build_info` :19, never throws) |


## Other modules

- `src/extension.ts` — activation entry (`activate` :64, `deactivate` :406); registers all
  `timescope.*` commands; module-level `_runtime`/`_context`/`_heartbeatInterval` singletons.
- `src/dashboard/controller/dashboard.ts` — `handle_dashboard` :10 creates the panel, injects
  asset URIs/CSP/nonce into `index.html`, routes `onDidReceiveMessage`.
- `src/dashboard/controller/dashboard_utils.ts` — pure `buildPayload` :8 +
  `filterRelevantErrors` :28 (shared with tests).
- `src/dashboard/webview/` — plain JS/HTML/CSS (copied, not compiled). `dashboard.js`
  rebuilds sessions client-side (`build_sessions_from_events` :147); `filter_state.js` is UMD
  (script tag + `require()` in Node tests).
- `src/ui/pick_job.ts` — job QuickPick incl. "New Job…" sentinel.
- `src/utils/fs_utils.ts` — `append_line_safe` :26; `write_file_atomic` :52 (temp+rename,
  Windows lock fallback — see gotchas).


## Data flow (Start pressed → dashboard)

Write path: status-bar command (`extension.ts`) → `Session.start()` creates an `Event` →
`logRepo.appendValidated` (state-legality check + dedup) writes the **one owned log**
(`.timescope/logs.jsonl` if opted in, else `scratch.jsonl`) and replicates the line into the
derived `index.jsonl` → `runtime.appendToCache` + `setActiveSession` (status bar + 1 s timer).

Read path: dashboard reads happen only on a `request_data` message —
`runtime.refreshEventCollection()` reloads `index.jsonl` fresh, `buildPayload` serializes
descending-timestamp DTOs, posted back as `summary_data`.

*(Wiki convention: text and tables, no mermaid — this file is read by agents; diagrams for
humans live in `docs/`.)*
