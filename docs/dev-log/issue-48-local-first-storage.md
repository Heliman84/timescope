# Issue #48 — Local-first storage architecture

> Decision log, not a spec. Started at plan time, finalized as a retrospective at PR time.
> Part of the [Local-First Storage arc](../arc-log/arc-local-first-storage.md) (Wave 2).

**Issue:** https://github.com/Heliman84/timescope/issues/48  ·  **PR:** (pending)

## Problem

The storage model was two coequal writable stores (global + workspace `logs.jsonl`, dual writes,
merge/dedup) with no single owner per event — the root cause behind #47/#2/#3/#6. This issue
re-architects to **local-first**: a repo's committed `.timescope/logs.jsonl` owns its events; the
global store becomes a derived, rebuildable index plus an owned scratch log for non-workspace
sessions. Delivers the user's critical priority #1 (parallel VS Code windows without interference)
and the #2 fix (opt-in `.timescope`).

## Decisions & trade-offs

Architecture is settled in issue #48. Implementation decisions made 2026-07-18:

- **Sliced into 3 shippable sub-PRs** (strangler-fig — each leaves a working, F5-able extension,
  no data-loss window):
  - **48a — Foundation (additive):** opt-in `.timescope` creation (fixes #2), `registry.json`
    (repos only: id, name, path, last_seen; binding deferred to #15), repo `config.json` (repo
    id). **No read/write model change** — still dual-writes, still merged read. Headline win: the
    #2 speculative-folder bug is gone.
  - **48b — Build the derived index in parallel:** `appendEvent` also replicates to
    `index.jsonl`; add `scratch.jsonl` (owned, non-workspace sessions); `TimeScope: Rebuild
    Global Index` command. Dashboard **still** reads the old merged view — the index is populated
    but not yet authoritative (de-risks the swap).
  - **48c — Cut over + migrate:** migrate existing global `logs.jsonl` → `scratch.jsonl` (`.bak`
    first), rebuild index, point the dashboard at `index.jsonl`, and drop the old global
    dual-write so repo logs + scratch are the only owned writes. Now fully local-first.
- **Legacy data → scratch, non-destructive.** Existing global `logs.jsonl` (historical hours,
  flat job strings, no owning repo) is backed up then repurposed as the global-owned scratch/
  legacy log; #15 later offers to map it to Client/Project/Task-type entities. (Lands in 48c.)
- **Dashboard reads the derived `index.jsonl`** (at 48c) — exercises replication for real; #3
  adds per-repo source filtering on top later.
- **`.timescope` edge case (#2):** if a `.timescope` folder already exists, assume opted-in
  (log locally); only a *missing* folder triggers the "Track time here?" prompt.
- **Out of scope for #48:** Client/Project/Task-type entities + the full binding init flow (#15);
  jobs.json handling is unchanged here.

## Slice progress

- [x] 48a — foundation: opt-in `.timescope` (#2 fixed), `registry.json` (repos), repo `config.json`.
      Testable core in `registry.ts` / `repo_config.ts` / `local_opt_in.ts`; opt-in mutates the
      shared `TimeScopePaths` object in place so `EventRepository`/`JobRepository` (which hold it
      by reference) pick up the workspace log with no repo recreation. `processes.md` storage
      diagram unchanged (still dual-write in 48a) — updated at 48c when the model flips.
- [x] 48b — parallel index + rebuild. `appendEvent` replicates each new event into the derived
      global `index.jsonl` (deduped by id), and — for non-workspace sessions only — into the owned
      `scratch.jsonl`. New `TimeScope: Rebuild Global Index` command reconstructs the index from the
      owned sources (registered repo logs + scratch). All additive: the old global/workspace
      dual-write and merged dashboard read are untouched (de-risks the 48c swap). New pure module
      `global_index.ts` (`append_owned_event`, `rebuild_index`, `registry_log_paths`); paths gain
      optional `global_index_path` / `scratch_path`. `processes.md` storage diagram still unchanged
      (model flips at 48c).
- [x] 48c — cutover + migration. **One owner per event**: `appendEvent` writes exactly one owned
      log (workspace when opted in, else the global-owned `scratch.jsonl`) and replicates into the
      derived `index.jsonl` — the old global dual-write is gone. The dashboard now reads the index
      (`Runtime.loadEventCollection`/`refreshEventCollection` → `loadIndexEntries`); edits resolve
      the target in the **owned** collection (`loadOwnedCollection`) and rewrite its owning log, then
      the index is rebuilt. A one-shot activation migration moves the legacy global `logs.jsonl` into
      scratch (`.migrated.bak` first, deduped by id, legacy file removed). `EventRepository`'s
      "global" location now physically means the global-owned store via a `_global_owned_path` getter
      (`scratch_path ?? global_log_path`), so unit tests that set only `global_log_path` are
      unaffected. Recovery/`appendValidated` read the owned union (`"both"`). `processes.md` storage
      diagram + I/O table flipped to local-first.

## Code-review findings (48a)

`/code-review` (medium) surfaced four:
- **Fixed now — registry write churn:** `register_if_opted_in` rewrote `registry.json` on every
  activation just to refresh `last_seen`; now it writes only when the repo is new or its
  name/path changed (also shrinks the concurrent-write window).
- **Fixed now — `.timescope`-as-file:** opt-in detection now requires a *directory*
  (`timescope_dir_opted_in`), so a stray file named `.timescope` can't be mistaken for opt-in
  and crash the first write.
- **Deferred to #47 — registry read-modify-write race:** two windows registering *different*
  new repos concurrently can drop one entry (load→upsert→save, last-writer-wins). This is the
  cross-process concurrency class #47 owns; the registry is rebuildable (48b), and robust
  multi-writer safety (locking or rebuild-from-repos) belongs with that work, not 48a.
- **Deferred to #47 — concurrent first-opt-in:** two windows opting a brand-new repo in
  simultaneously can mint divergent repo_ids. Same concurrency class; narrow (first-ever opt-in
  only).

## Follow-on during F5

- **US-06 pulled into #48 — repo jobs cached in `config.json`.** Opening a repo now surfaces its jobs
  in the Start picker even with an empty global. `config.json` gains a `jobs` cache (id + title, v2);
  `repo_jobs.ts` (`derive_repo_jobs` from the owned log, `ensure_repo_jobs_cache` auto-upgrades an
  older log-only repo, churn-free). `Runtime.pickableJobs()` = global ∪ repo cache (deduped);
  `refreshRepoJobs()` runs at activation (opted-in only, never speculative) and after each Start.
  Interim flat-job model; #15 restructures into the entity model (US-06 says as much). *The user
  reversed the earlier "defer to #15" call — local-first was unusable without it.*
- **Migration observability — `TimeScope: Show Storage Status`.** Migration was a silent one-shot
  toast, easy to miss and impossible to re-check. New read-only command reports index/scratch counts,
  legacy-log/backup presence, registry repos + declines, and cached jobs — the reliable signal for
  every F5 check.

## Follow-on (registry opt-out)

- **Opt-out moved to the registry.** "Never for this folder" now persists in `registry.json`
  (`declined[]`) instead of VS Code `workspaceState`, per the adopted *travels → repo; machine-local
  → registry* rule. `Registry.is_declined/add_declined/remove_declined` + `local_opt_in`
  `is_folder_declined/decline_folder/undecline_folder`; the opt-in prompt reads/writes the registry.
  Pulled forward from #6 (only the reversal *UI* stays there) because it's testable now by inspecting
  the file. Additive schema — old registries load with an empty `declined`.

## Bugs found during F5

- **Phantom open session → recovery double-stop (48c).** During 48a/48b `appendEvent`
  dual-wrote every event to the global log *and* the workspace log; 48c migration then
  moved the global log into `scratch.jsonl`. So the same event id now lives in both
  scratch and the workspace log. `loadSessions`/`loadLastNSessions` for `"both"`
  concatenated the two stores **without** deduping by id (unlike `loadAllEntries`), so a
  closed session's duplicated `start` was reconstructed as a lone phantom *open* session
  — recovery then offered to "close" it, appending a second `stop`. Fix: dedup by event
  id in the multi-store session readers (regression test in `test_event_repository.ts`).
  The duplicate ownership itself (scratch holding copies of workspace-owned events after
  an upgrade) is benign for reads — the index rebuild and `loadAllEntries` both dedup by
  id — so the reader-level dedup is the correct, general safeguard rather than special-
  casing migration.

## Deferred to #15

- **Repo-log jobs aren't pickable on a fresh/cloned repo.** Jobs load only from the global
  `jobs.json`; a committed `.timescope/logs.jsonl` references jobs by id+title but nothing surfaces
  them, so opening an existing repo shows an empty/partial Start picker and forces manual re-typing.
  This is the legacy→local-first *job conversion* case. `Job.fromEventFields` already reconstructs
  partial jobs from events, but the real fix belongs in #15's entity model (Client/Project/Task-type
  + repo binding + global vocabulary). Noted on the issue:
  https://github.com/Heliman84/timescope/issues/15#issuecomment-5012746866

## Rejected approaches

- **Making the dashboard read the owned union (scratch + workspace) instead of `index.jsonl`.**
  Simpler (no read/derived split), but it would show only the current window's data and never
  exercise the replicated index — defeating the point of the cutover and the foundation #3 builds
  on. Rejected: the dashboard reads the derived index; edits target the owned logs.
- **Repointing the `global_log_path` field itself at `scratch.jsonl`.** Lowest churn, but it makes
  the field name lie about the file and forces the many existing `global_log_path`-based tests to
  change. Chose a private `_global_owned_path` getter (`scratch_path ?? global_log_path`) instead:
  production uses scratch, and tests that set only `global_log_path` keep their exact behaviour.

## Retrospective

Shipped as 3 clean slices on one branch (48a foundation → 48b parallel index → 48c cutover), each
leaving an F5-able extension. The strangler-fig order paid off: 48c's risky write-model flip landed
against an already-populated, already-tested index and scratch.

**What changed from the plan:** none materially. The one design call made during 48c (not pre-decided
in the arc) was **edit scope after cutover** — the dashboard shows the global derived view of all
hours, but editing is limited to events *owned by the current window* (this repo's log + scratch).
Cross-repo editing needs the owning repo's log and is deferred to #43 (amend). For single-repo use
(and the F5 fixtures) everything on screen is owned, so editing is unaffected.

**Deferred (unchanged):** the two multi-writer registry races found in 48a review remain #47's; the
index rebuild-on-activation shrinks but doesn't close concurrent-write windows — also #47.
