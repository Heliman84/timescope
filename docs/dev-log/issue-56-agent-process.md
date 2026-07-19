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
- **Tier 2 waves use sub-branch PRs into the feature branch** (`feature/issue-<N><letter>--<slug>` — the naming iterated, see the letter-index bullet below; `track` label, worktrees the user never opens; the double hyphen exists because git refs can't nest under an existing branch name). User touchpoints: scope, one F5 on the assembled branch, the final PR.
- **Docs split by audience**: `docs/agent-process.md` (human reminder, diagram-first) + `docs/agent-process-foundation.md` (portable, for seeding other repos — firmware/python/web/robotics/CV tuning table). The playbook agents actually follow is the `delegate` skill.
- **Wiki is text/tables only — no mermaid.** The wiki is agent-consumed, and structured text with `file:line` anchors is denser and more reliable for a model than diagram syntax; mermaid earns its keep with humans, so diagrams live in `docs/`.
- **Track branches letter-indexed next to the issue number** (`feature/issue-<N><letter>--<slug>`, e.g. `issue-47a--multi-instance`) instead of a trailing track suffix — the differentiator survives truncated branch lists, and the letterless name is always the core feature branch.
- **Arc mode added to the process** (user request — repeatedly "lost the forest" during the local-first arc): the arc log is the spine (north star, build order, live status table updated by scribe at each PR), and during an arc every status update and F5 handoff opens with the breadcrumb `Arc <slug> — wave X/Y — issue #N (<track>)`. Generalized into foundation §7.
- **Spine & satellite windows for arcs** (user proposal, refined): the main window/chat on develop is a coordination-only spine — never edits source, never holds a feature branch, rehydrates entirely from the arc log (disposable-but-durable). Per issue the spine dispatches an in-spine agent wave (well-specified) or a satellite VS Code window on a worktree (human-heavy — gets local F5). Chats can't talk to each other, so durable records are the only interface; the handoff into a cold satellite chat is a one-line starter prompt the user pastes.
- **Release qualification** (deep gate too expensive per-feature: install smoke, property/fuzz, corpus replay) filed as its own issue rather than bundled here; the wiki seed came from a one-shot Explore sweep (~167k tokens spent in an isolated context — the pattern proving itself during its own construction).


## Rejected approaches

- One monolithic "implementer" agent — loses the core/UI toolchain split and blocks parallel waves.
- "Orchestrator" as a defined agent — duplicates the main thread; adds a hop to every decision.


## Retrospective

Shipped: 8 agent definitions (model + effort pinned by judgment density), a 6-page agent
wiki seeded from a single ~167k-token Explore sweep, the `delegate` skill (tiers, waves,
briefs/packets, F5 packet, arc mode), CLAUDE.md policy, all three loop skills wired, and two
process docs (human reminder + portable foundation). Release qualification split off as #57.

Changes from the original issue: the roster grew from the issue's four sketched agents to
eight; the wiki went from a 4-file concept to the co-worker's proven 6-file set with
200-line budgets and human blurbs; arc mode and the **spine/satellite window topology**
weren't in the issue at all — they emerged from review discussion about losing the forest
during the #48 arc. Sub-branch naming iterated twice (slash-nesting is invalid in git refs;
trailing track suffix truncates badly → letter index next to the issue number).

For a future reader: the process gated itself — this branch's pre-PR review/verification ran
through the reviewer/verifier agents it introduces, and the wiki convention became text-only
after concluding mermaid serves humans, not models. Wave 3 of the local-first arc (#47
in-spine, #15 as the first satellite) is the intended shakedown.
