# Issue #42 — Webview malformed-stream coverage (42b: webview track)

> Decision log, not a spec. Started at plan time, finalized as a retrospective at PR time.

**Issue:** https://github.com/Heliman84/timescope/issues/42  ·  **PR:** (pending)

## Problem

The dashboard's `build_sessions_from_events` (dashboard.js) runs its own state machine over raw
event streams, and malformed/unbalanced streams are production reality (real log: 145 pause vs
122 resume). Its tolerances were undocumented and untested — nothing pinned how the dashboard
renders a dangling start, an unresumed pause, an orphan resume, a stop without a start, or a
double start. This branch is the webview half of #42, run in parallel with the storage half (42a).

## Decisions & trade-offs

- **Pure test addition** — no product code changes. The current tolerances (verified by reading
  the state machine) are reasonable and now become pinned behavior:
  - dangling start → session dropped (explicit comment in code: open sessions are ignored)
  - pause never resumed → paused tail excluded from duration; **no** pause pair counted
  - resume without pause → ignored entirely
  - stop without start → ignored entirely
  - double start → first session finalized *at the second start's timestamp*, task taken from
    the first start event
- One fixture (`build_malformed_fixture`) with five single-purpose jobs (Dangle, Orphan, Skip,
  Ghost, Twice) so each scenario's state machine is isolated per job — mirrors the existing
  `build_filter_fixture` style.
- All events placed "today" relative to `FIXED_NOW` so the default Last-4-Weeks preset never
  interferes with row counts.

## Rejected approaches

- Asserting through the Node-side `EventRepository.loadSessions` too — that path already has
  unit coverage and (deliberately) differs: it *finalizes* dangling sessions, the webview drops
  them. The divergence is now documented here rather than papered over.

## Retrospective

(filled at PR time)
