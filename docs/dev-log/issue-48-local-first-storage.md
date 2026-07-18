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

(filled during planning — see issue #48 for the agreed architecture; open implementation
decisions being worked with the user before code)

## Rejected approaches

## Retrospective

Filled in at PR time.
