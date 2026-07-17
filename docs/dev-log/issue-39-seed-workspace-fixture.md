# Issue #39 — Seed a workspace-local fixture to exercise cross-file dedup/merge

> Decision log, not a spec. Started at plan time, finalized as a retrospective at PR time.
> Keep it short — capture the *why*, not a blow-by-blow. Skip any section that doesn't apply.

**Issue:** https://github.com/Heliman84/timescope/issues/39  ·  **PR:** <link>

## Problem

`npm run seed-testdata` only seeded the global store, so F5 never exercised the global+workspace merge
path (`loadAllEntries` dedup by event ID, and unique workspace jobs/events surfacing in the summary).

## Decisions & trade-offs

- **Workspace log = a subset of global (last week) re-emitted with identical IDs + ~4 unique events.**
  Duplicating the *same IDs* is what exercises `loadAllEntries` dedup; a subset (not all) keeps the fixture
  small while still overlapping. If dedup ever regressed, the duplicated week's hours would visibly double.
- **A workspace-only job "Local Client" carries ~2 of the unique events.** Verifies a both-files job appears
  in the summary. It works today only because the dashboard derives job identity from the `job_title`
  *embedded in each event* (`buildPayload` → `ev.job_title`), not from `jobs.json`.
- **Also write a workspace `jobs.json` (global jobs + "Local Client").** Currently cosmetic —
  `JobRepository.loadAll()` reads only the global `jobs.json` — but it's the correct fixture shape for the
  planned local/global filter. The gap (workspace jobs not merged) is noted, not fixed here.
- **Test-tooling only.** No `src/` or extension-runtime changes, no new deps. Regenerate the global store
  exactly as before; the workspace store is additive.

## Rejected approaches

- Duplicating *all* global events in the workspace log — larger fixture with no extra coverage over a subset.
- Fixing `JobRepository.loadAll()` to merge workspace jobs — real behavior change, out of scope for a seed
  fixture; belongs with the future local/global filter feature.

## Retrospective

Shipped as planned. `scripts/seed_test_data.js` now writes both stores via a shared `write_store(dir, jobs,
events)` helper and a `push_session` helper (extracted from the old inline closure). The global store is
byte-identical to before; the workspace store re-emits the last-week subset of global events (same objects →
identical deterministic IDs) plus 4 unique events, 2 under a workspace-only "Local Client" job.

Verification (no unit test — this is a `scripts/` dev tool over compiled `out/`, like the existing seed
script): ran `npm run seed-testdata`, then simulated `loadAllEntries` dedup across both files — 118 raw lines
→ 96 merged unique (92 global + 4 unique), 22 duplicates collapsed, all four jobs incl. "Local Client"
present once. Matches the acceptance criteria; F5 confirms it visually.

No deviations from the plan. Left as noted-not-fixed: `JobRepository.loadAll()` still reads only the global
`jobs.json` (workspace jobs surface via event-embedded titles) — a real merge belongs with the future
local/global filter.
