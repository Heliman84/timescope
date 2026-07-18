# Issue #42 — Log hygiene (42a: storage track)

> Decision log, not a spec. Started at plan time, finalized as a retrospective at PR time.

**Issue:** https://github.com/Heliman84/timescope/issues/42  ·  **PR:** (pending)

## Problem

Real production `logs.jsonl` contains a physical line with two concatenated JSON records — the signature of appending to a file missing its trailing `\n`. Exploration found it's worse than the issue assumed: there is **no tolerant reader** — a concatenated line fails `Event.fromJSONL` and silently vanishes from all analysis (though rewrites preserve it verbatim). Separately, all full-file rewrites (`renameJobInLogByJob`, `replaceEvent`) are raw `writeFileSync` — a crash mid-rewrite tears the log.

This is Wave 1 of the focus-milestone re-architecture (see #48): the zero-regret substrate. The webview malformed-stream test coverage is the parallel 42b branch.

## Decisions & trade-offs

- **Split #42 into two parallel worktree branches** (42a storage / 42b webview tests) — disjoint tracks, two PRs, both referencing #42.
- **New primitives live in `fs_utils.ts`** (`append_line_safe`, `write_file_atomic` — pure fs concerns); the **line-splitting + report logic lives in `src/core/log_sanitizer.ts`** (log-domain knowledge). snake_case per coding standards, despite older camelCase neighbors.
- **All log reads route through the sanitizer** (single choke point in `EventRepository`), so healed logical lines are consistent everywhere — including the line indices derived from them. Disk is never touched on load.
- **User-initiated rewrites (edit/rename) write sanitized content atomically** — this repairs concatenation as a side effect. Not a violation of "no silent rewrites": the user explicitly asked for a write; "no silent" refers to load-time.
- **Damage notification = QuickPick** ("Compact now" / "Ignore"), following the existing `recovery.ts` pattern — user's explicit choice over `showWarningMessage` buttons. Shown at most once per session.
- **Unbalanced pause/resume counts are reported but don't gate the compact prompt** — compaction can't repair data-level imbalance, only re-serialize it. Repairable damage = concatenated lines / missing header / non-canonical serialization.
- **`timescope.compactLog` added to `package.json` `contributes.commands`** — explicitly approved by user (CLAUDE.md gate).
- Compaction: `.bak` copy first, temp-file + atomic rename, idempotent (second run detects no change, writes nothing, leaves `.bak` alone). Truly-unparseable lines are preserved verbatim, same as today's rewrite behavior.

## Code-review findings (fixed)

- `write_file_atomic` rename can throw EPERM/EBUSY on Windows when a sync client/AV holds the
  target → now falls back to an in-place write (non-atomic, but succeeds where the old code did
  instead of crashing dashboard edits/renames/compaction).
- Compaction clobbered a pre-existing `.bak` → a second backup now gets a timestamped name;
  the earlier last-known-good backup is preserved.
- Every read paid a full per-line `Event` parse for a report nobody used → hot-path reads use
  `count_events: false` (split detection is a regex fast-path with zero parsing on clean lines);
  only `checkLogHealth` computes the full report.

## Rejected approaches

- `showWarningMessage` with action button — standard VS Code idiom but no precedent in this codebase; user chose QuickPick consistency.
- Sanitizing only in `loadSessions` — leaves the dedupe/index reads inconsistent with the analytical reads; single choke point is safer.

## Retrospective

Shipped as planned plus three additions along the way:

- **Code review caught real gaps** (all fixed): Windows rename-over-locked-file needed an
  in-place-write fallback; `.bak` needed non-clobbering names; and the sanitizer's per-line
  event parsing was too expensive for hot-path reads — split detection became a zero-parse
  regex fast-path and full reports are computed only by `checkLogHealth`.
- **`seed-testdata --damaged`** grew out of F5 testing: one command seeds the exact damage
  the sanitizer targets. DEVELOPMENT.md's stale seeder section got a full mode table.
- The biggest surprise vs the issue text: there was **no tolerant reader** — glued records
  weren't being healed, they were silently dropped from analytics. This branch is a small
  data-recovery fix, not just hygiene: the production log's two glued records re-enter stats.

F5-verified with a damaged seed: prompt appears once, compaction repairs with `.bak`,
appends to a newline-less file stay valid, clean logs show no prompt.
