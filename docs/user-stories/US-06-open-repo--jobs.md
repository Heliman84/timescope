# US-06 — Open an existing repo for the first time - what happens with logged jobs?

**As** the user, when I first open an existing repo that already has timescope logs, I expect to see the jobs from the log as options in the picker, so that I can continue tracking without re-typing anything.


## Context

When I open, for the first time, an existing or cloned repo that already has a committed `.timescope/logs.jsonl` and (optionally `.timescope/config.json`) — I interpret this to mean that TimeScope has been set up for this repository. There may be past sessions across several jobs. This is the
everyday local-first case: the repo carries its own history. It might be a fresh machine, a clone, or a machine whose *global* job list simply doesn't know this repo's jobs.


## Trigger

I open the repo and press **Start** to begin (or continue) tracking in it.


## Expected experience

- (When the folder is first opened) - If the `.timescope/logs.jsonl` is present but the `.timescope/config.json` file is not then this indicates an older architecture.
  - I expect TimeScope to automatically update the structure to have a `config.json` file with all the appropriate information and mesh this with the machine's global TimeScope information (including the jobs from the local log).
- At Start of a timed job, the **jobs already present in the repo are offered in the picker**. I pick one and keep going. I re-enter nothing.
- New sessions append to the repo's local log under the job I picked.


## Must NOT happen

- I must **not** have to manually re-type jobs that already exist in the repo's log — *"a very low probability of success as a manual process, let alone the time."*
- No duplicate or parallel job created for a job that already exists (same `job_id`) in the local or global jobs.
  - If there is conflicting job information e.g. two jobs in the global registry with the same name and different job_id. Then a TBD process will reconcile the issues.
- Picking an existing repo job must not silently mint a **new** job with a different id.
- Opening the repo must not hide, drop, or reorder its history.


## Edge cases

- **A job renamed globally vs. the title stored in the log** — identity is `job_id`; the title is display-only, so the right (current) name should show.
- **Large job history** — the picker stays usable (e.g. recent/active jobs first).


## Traceability

- **Delivered by:** [#48](https://github.com/Heliman84/timescope/issues/48) — repo-owned logs +
  registry, **and** the repo-side job cache in `config.json` (auto-upgrades an older log-only repo,
  unioned into the Start picker). [#15](https://github.com/Heliman84/timescope/issues/15) restructures
  the cache into the Client/Project/Task-type entity model.
- **Related:** [[US-05]] (time committed with the repo), [[US-09]] (hierarchical picking),
  [[US-10]] (management UI), [[US-12]] (opt-in).
- **Revisit after #15:** the flat "jobs" terminology here will likely become Client/Project/Task-type,
  and the `config.json` cache details firm up — expect to retouch this story then.
- **Open questions:**
  1. How we handle conflicting job information between the local repository and the global registry (e.g. same job name, different job_id). TBD.
