# Issue #36 — Add per-branch/PR development log documents under docs/

> Decision log, not a spec. Started at plan time, finalized as a retrospective at PR time.

**Issue:** [#36](https://github.com/Heliman84/timescope/issues/36)  ·  **PR:** [#38](https://github.com/Heliman84/timescope/pull/38)

## Problem

The durable record was just the GitHub issue + PR description — good for *what* changed, but the reasoning that shaped scope (options weighed, trade-offs, rejected approaches) evaporated once an issue closed and scrolled off. The #35 scope debate and versioning-policy discussion were the motivating example.

## Decisions & trade-offs

- **Convention:** `docs/dev-log/issue-<N>-<slug>.md`, one per feature branch.
- **Lifecycle:** created at *plan time* as a living doc, revised into a *retrospective* at PR time. Not a heavyweight up-front spec — it grows with the work.
- **Reconcile the old "No spec files" rule by replacing, not deleting it.** That rule was reacting to the previous workflow's large, cumbersome specification files. This log is explicitly the opposite (short, decision-focused), so the line becomes "issue + PR + short dev-log; no *heavyweight* spec files" — keeping the anti-bloat intent while making room for the log.
- **Lightweight skeleton template** (Problem / Decisions & trade-offs / Rejected approaches / Retrospective), sections skippable — chosen over a detailed template to avoid re-introducing the bloat the old rule fought.
- **Backfill #35** as a worked example and to capture its reasoning before it's gone.

## Rejected approaches

- **Detailed, prescriptive template** — rejected as bloat risk (see above).
- **Write the log only at PR time** — rejected; capturing decisions live at plan time is the whole point, since that's when the reasoning exists.

## Retrospective

Shipped as planned — pure docs/skills change, no runtime surface, so no F5 check applied (a note worth carrying: the feature loop's F5 handoff doesn't fit process-only PRs). Deliverables: `TEMPLATE.md`, the backfilled #35 log, this log (dogfooding the process on its own PR), and the reworded "no heavyweight spec files" line across `feature/SKILL.md` and `CLAUDE.md`. The only "no spec files" reference actually lived in `feature/SKILL.md`, not `CLAUDE.md` as the issue guessed — reconciled in the one place it existed.
