# Issue #56 — Dev process: leverage subagents to reduce context inflation

> Decision log, not a spec. Started at plan time, finalized as a retrospective at PR time.
> Keep it short — capture the *why*, not a blow-by-blow. Skip any section that doesn't apply.

**Issue:** [#56](https://github.com/Heliman84/timescope/issues/56)  ·  **PR:** *pending*


## Problem

The three chat-driven loops run everything inline in one context — exploration, debugging, doc drafting, review — so long efforts (the #48 arc) inflate the main window badly. We want a lean orchestrator thread that delegates verbose/mechanical work to subagents, runs faster via parallelism, and uses cheaper models where judgment isn't critical.


## Decisions & trade-offs

- **Tiered delegation, not always-on.** Single-file/trivial changes stay inline (spawning agents there is pure overhead). Standard features delegate exploration/review/docs/gate. Multi-track work goes parallel in worktrees.
- **Model mapping by judgment density, not prestige.** opus only for planning and review (low token volume, high stakes); sonnet for the token bulk (exploration, implementation, verification, docs); haiku as an override for trivially mechanical tasks. No fable — user access ends 2026-07-20.
- **The orchestrator is the main chat thread, not an agent.** A co-worker's setup has an "orchestrator" agent; in Claude Code that role already exists as the main session, which must hold decisions and user gates (F5, PR merge) anyway.
- **Reviewer (judgment) split from verifier (mechanical gate)** so they can run on different models and the reviewer stays adversarial rather than checklist-driven.
- **Agent wiki** (`.claude/wiki/`) adopted from the co-worker's setup: distilled operational knowledge agents read before exploring, with a hard size budget and curation at PR time — so exploration cost compounds down over time instead of being re-paid every session. Sized per his proven set (6 files, ~200-line budget, a ≤20-word human blurb atop each); his `log.md` activity log dropped (git history + dev-logs cover provenance). Also adopted from his files: terse checklist agent defs with fixed output packets, and a PR-time wiki lint.
- **Effort pinned per agent, by "cost to unwind a mistake"**: architect/planner high (opus), reviewer medium (opus), scout/builders medium (sonnet), verifier/scribe low (sonnet). Orchestrator (main thread) runs opus — post-delegation it's the lowest-volume, highest-judgment context.
- **Architect agent added** (roster of 8) as a *study generator* only — options/trade-offs/failure modes; decisions stay in the main thread with the user, since subagents can't converse with them.
- **Tier 2 waves use sub-branch PRs into the feature branch** (`feature/issue-<N>-<slug>--<track>`, `track` label, worktrees the user never opens; double-hyphen because git refs can't nest under an existing branch name). User touchpoints: scope, one F5 on the assembled branch, the final PR.
- **Docs split by audience**: `docs/agent-process.md` (human reminder, diagram-first) + `docs/agent-process-foundation.md` (portable, for seeding other repos — firmware/python/web/robotics/CV tuning table). The playbook agents actually follow is the `delegate` skill.
- **Wiki is text/tables only — no mermaid.** The wiki is agent-consumed, and structured text with `file:line` anchors is denser and more reliable for a model than diagram syntax; mermaid earns its keep with humans, so diagrams live in `docs/`.
- **Track branches letter-indexed next to the issue number** (`feature/issue-<N><letter>--<slug>`, e.g. `issue-47a--multi-instance`) instead of a trailing track suffix — the differentiator survives truncated branch lists, and the letterless name is always the core feature branch.
- **Arc mode added to the process** (user request — repeatedly "lost the forest" during the local-first arc): the arc log is the spine (north star, build order, live status table updated by scribe at each PR), and during an arc every status update and F5 handoff opens with the breadcrumb `Arc <slug> — wave X/Y — issue #N (<track>)`. Generalized into foundation §7.
- **Release qualification** (deep gate too expensive per-feature: install smoke, property/fuzz, corpus replay) filed as its own issue rather than bundled here; the wiki seed came from a one-shot Explore sweep (~167k tokens spent in an isolated context — the pattern proving itself during its own construction).


## Rejected approaches

- One monolithic "implementer" agent — loses the core/UI toolchain split and blocks parallel waves.
- "Orchestrator" as a defined agent — duplicates the main thread; adds a hop to every decision.


## Retrospective

*To be filled at PR time.*
