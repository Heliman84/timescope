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
- [ ] 48b — parallel index + rebuild
- [ ] 48c — cutover + migration

## Rejected approaches

## Retrospective

Filled in at PR time.
