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

The plan held — no scope surprises. Built in the planned S1→S2→A1→B1→A2→A3→B2 order: registry
entities → repo-config binding/pins → pure `task_types.ts` helpers → Runtime wiring → Start
command wiring → attributed dashboard payload → webview hierarchy rendering.

New shared helper not explicitly planned: `id_gen.ts` factors the FNV-1a/base36 id derivation
out of `job.ts` so client/project/task-type ids mint the same way — `mint_unique_id` adds a
salted-retry loop for hash collisions (small id space, distinct seeds can collide), which the
original `Job.create` path didn't need to handle for a single entity kind.

**Reviewer findings, all fixed pre-PR:**
- **Id-collision minting gap** — entity minting used the raw seeded hash with no check that the
  candidate id already belonged to a *different* entity. Fixed by routing all minting through
  `mint_unique_id`'s `is_taken` guard (`id_gen.ts`).
- **`convert_legacy_job` dangling pin** — converting onto an unknown/deleted `target_task_type_id`
  pinned it into the repo config anyway, even though the alias wasn't recorded. Fixed to a full
  no-op (registry and config both returned unchanged) when the target doesn't resolve.
- **Edit-reply attribution loss** — `edit_log_entry`/`edit_log_entries` replied with the plain
  `buildPayload` (no client/project/task_type/source_repo_id), so a Save silently collapsed
  hierarchy grouping back to flat titles until the panel was reopened. Fixed by routing all three
  `edit_result` reply sites through the same `build_dashboard_payload` used by `request_data`.

**Webview discovery, not a reviewer finding:** `dashboard.js`'s `load_payload` explicitly
allowlists which DTO fields survive into its in-memory event objects — new attribution fields
(`source_repo_id`, `client`, `project`, `task_type`) had to be added there explicitly or they'd
silently disappear before `hierarchy_label` ever saw them. Worth checking this allowlist whenever
a future payload field is added.

**F5 round 1 findings, all fixed on-branch:**
- **Binding not persisted (re-prompted every Start).** `ensure_repo_jobs_cache` (US-06) rewrote
  `config.json` as a fresh `{repo_id, format_version, jobs}`, clobbering `binding` +
  `pinned_task_types` one run after a new session changed the derived job set. Now preserves all
  existing config fields. This was also why the dashboard showed no Client/Project — the binding
  was erased before `attribution.ts` could read it. Regression test in `test_repo_jobs.ts`.
- **"New Task-type…" keyboard dead-end.** The sentinel branch delegated to
  `pick_or_create_task_type` with empty candidates, showing a redundant second picker (had to be
  mouse-clicked twice; Enter did nothing). Extracted `create_task_type` so "New…" goes straight
  to the input box.
- **Dashboard hierarchy display → dedicated column.** Per user preference, replaced the single
  "Client › Project › Task-type" joined cell with a dedicated **Client / Project** column left of
  the **Task** column (task-type alone); unbound/unassigned rows show "—". The old free-text
  "Task" column became "Notes". Grouping/merge, legend, and edit-modal behavior unchanged.

**Deferred to follow-up issues (on the Local-First Rework milestone):**
- [#62](https://github.com/Heliman84/timescope/issues/62) — dashboard filtering by the new
  Client/Project column (a new filter dimension; not an easy add during #15).
- [#63](https://github.com/Heliman84/timescope/issues/63) — improve the legacy-job → Task-type
  conversion UX (works, but clunky mid-Start; likely pairs with #6).

**Spec follow-up still owed:** the additive registry/repo-config fields (`clients[]`,
`projects[]`, `task_types[]`, `binding`, `pinned_task_types[]`) need documenting in
`docs/record_format_spec.md` once the storage track releases that file this wave — flagged to
the arc spine, not resolved here.
