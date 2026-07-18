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
- [ ] 48c — cutover + migration

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

## Rejected approaches

## Retrospective

Filled in at PR time.
