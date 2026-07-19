# Issue #15 — Hierarchical jobs (Client › Project › Task-type)

> Decision log, not a spec. Started at plan time, finalized as a retrospective at PR time.
> Keep it short — capture the *why*, not a blow-by-blow. Skip any section that doesn't apply.

**Issue:** [#15](https://github.com/Heliman84/timescope/issues/15)  ·  **PR:** TBD  ·  **Arc:** [local-first-storage](../arc-log/arc-local-first-storage.md) (wave 3, webview track)

## Problem

Jobs are a single flat string ("Lantern - Speaker - EE CAD"). #48 shipped basic pickability
(US-06 flat cache in `config.json`); this issue restructures that into real
Client → Project → Task-type entities so the Start picker only asks for the task-type
(strict binding supplies Client/Project from the repo) and the dashboard can group by hierarchy.

## Decisions & trade-offs

- **No event-format change at all.** The issue's re-scope anticipated a format bump ("events
  reference IDs"), but events *already* carry `job_id`. Going forward that field references a
  task-type id; Client/Project are derived from the owning repo's binding (strict binding) and
  never stored per event. Dissolves the spec pressure entirely — `docs/record_format_spec.md`
  is owned by the storage track this wave and stays untouched.
- **All on-disk changes additive-optional, no version bumps.** Registry stays `format_version 1`
  and gains optional `clients[]`, `projects[]`, `task_types[]` (stable ids; names display-only;
  task-types carry `aliases[]` = adopted legacy job_ids, with room for a later `owner_project`).
  Repo config stays `format_version 2` and gains optional `binding {client_id, project_id}` +
  `pinned_task_types[]`. Follows the established `declined`-style additive pattern.
  **Spec follow-up owed:** these additions need documenting in `record_format_spec.md` once the
  storage track releases the file — surfaced to the arc spine rather than edited here.
- **Legacy conversion is inline-at-pick, not a command.** New commands would touch
  `package.json` (user-gated) and management UI belongs to #6. Picking a legacy flat job in the
  Start picker offers conversion: pick-or-create the task-type, record the old `job_id` as an
  alias, pin it. History unifies via the alias — no log rewrites.
- **Dashboard reads owned sources directly, not `index.jsonl`.** The index carries no per-event
  source attribution and its format is locked this wave, so the controller walks the registry's
  repo logs + scratch, dedups by event id, and tags sources in memory. Client/Project resolve
  via source repo → binding; task-type via `job_id` (direct or alias); everything else lands in
  an "Unassigned" bucket under its flat title. The index stays maintained on disk for other
  consumers. Same attribution infrastructure #3 (scope filtering) will need.
- **Tier 1 sequential, not a Tier 2 wave.** The payload is a hard consumer of the entity model
  and `runtime.ts` is shared-risk between picker and dashboard wiring — the planner found the
  split not cleanly disjoint, so slices run S1→S2→A1→B1→A2→A3→B2 with one builder at a time.

## Rejected approaches

- **Per-event client/project fields** — needs an event-format bump (spec locked; storage track
  owns it) and contradicts strict binding, which makes them derivable.
- **Tagging source repo into `index.jsonl`** — index format is spec-documented and locked;
  in-memory tagging achieves the same without touching disk formats.
- **A "Convert jobs" command** — requires `package.json` contributions (user-gated) and
  duplicates #6's management surface.

## Retrospective

Filled in at PR time: what actually got built, anything that changed from the plan, and what a future reader should know.
