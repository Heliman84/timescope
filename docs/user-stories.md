# TimeScope — User Stories (index)

The shared source of truth for *what TimeScope must do for its user*. Each story is a short prose
**story** — context, trigger, expected sequence, and what must **not** happen — one file in
[user-stories/](user-stories/), structured from [TEMPLATE.md](user-stories/TEMPLATE.md). Issues
implement stories; this index is the map. Stories are the *why*, not a spec.

**The user:** a solo consulting engineer who bills clients hourly and works across several git repos
(often one per client/project), from inside VS Code. Success = never lose billable time, never fight
the tool, trust the numbers.

**North-star** (from the [arc](arc-log/arc-local-first-storage.md)): (1) **parallel clients** — many
windows tracking different repos without interference; (2) **hierarchical jobs** — Client → Project →
Task-type.

## Index

Story: ✍️ written · ✎ to write.  Build: ✅ done · 🚧 partial/seam · ⬜ not started.

| ID | Title | Story | Build | Delivered by |
|----|-------|-------|-------|--------------|
| US-12 | Opt in to tracking a folder | [✍️](user-stories/US-12-opt-in.md) | ✅ | [#2](https://github.com/Heliman84/timescope/issues/2) |
| US-06 | Open an existing repo and use its jobs | [✍️](user-stories/US-06-open-repo--jobs.md) | ✅ | [#48](https://github.com/Heliman84/timescope/issues/48) (config.json job cache) |

## Backlog — stories still to write

Placeholders only — **not** yet real stories. Write each from the template before it drives work; do
not treat these one-liners as requirements.

- **US-01** start/pause/resume/stop from the status bar — (core)
- **US-02** tag a session with a job + task note — (core)
- **US-03** review hours in a filterable dashboard — [#5](https://github.com/Heliman84/timescope/issues/5)
- **US-04** parallel windows never corrupt each other — [#48](https://github.com/Heliman84/timescope/issues/48)/[#47](https://github.com/Heliman84/timescope/issues/47)
- **US-05** time committed *with* the repo — [#48](https://github.com/Heliman84/timescope/issues/48)
- **US-07** off-project/admin time still tracked — [#48](https://github.com/Heliman84/timescope/issues/48)
- **US-08** one global dashboard across all repos — [#48](https://github.com/Heliman84/timescope/issues/48)
- **US-09** hierarchical Client → Project → Task-type picking — [#15](https://github.com/Heliman84/timescope/issues/15)
- **US-10** management UI — a **"Settings" tab in the Summary view** to manage jobs, view/edit repos & bindings, trigger Rebuild Global Index, and **reverse per-folder opt-in/opt-out** — [#6](https://github.com/Heliman84/timescope/issues/6) *(shape settled as a tab; build-order confirmed after #43 per the arc)*
- **US-11** correct a session's times/notes after the fact — [#43](https://github.com/Heliman84/timescope/issues/43)
- **US-13** filter the dashboard by source/repo — [#3](https://github.com/Heliman84/timescope/issues/3)

*(This backlog is seeded from the issues and may not match your original list — paste yours and we
reconcile. Placeholders get renumbered/merged as real stories are written.)*
