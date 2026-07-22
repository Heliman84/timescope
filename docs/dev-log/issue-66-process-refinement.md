# Issue #66 — Process refinement (mid-cycle retrospective on wave 3)

> Decision log, not a spec. Written at two checkpoints — plan-time and PR-time.

**Issue:** [#66](https://github.com/Heliman84/timescope/issues/66)  ·  **PR:** [#67](https://github.com/Heliman84/timescope/pull/67)  ·  **Follows:** [#58](https://github.com/Heliman84/timescope/issues/58), [#61](https://github.com/Heliman84/timescope/pull/61)

## Problem

Wave 3 (#15, #47) was painful, slow, and token-hungry — the user estimated ~24h and ~3 sessions
of full Claude allocation for two issues, with #15 spawning 3–4 follow-up issues. Profiling both
satellite transcripts (evidence, not impression) found the cause is **session shape, not the
model**:

- Two ~19h sessions, **~125 turns, zero compactions**, context pinned near **200K–224K** for the
  entire back half; combined ~59M cache-read tokens ≈ the "3 sessions" cost.
- In #15, average response **collapsed from 2,045 → 290 tokens** as context saturated — this is
  the "Opus felt like it lacked intelligence" perception. Same model, starved conditions.
- **Delegation never offloaded**: 7–8 agent spawns but every source edit and all prose on the
  main thread (0 sidechain).
- #15 thrashed in *source* (test registry 6×, picker 4×) and spawned follow-ups; #47 churned its
  *dev-log* 11×. #47 was only *less* saturated — not a good outcome.

The gap: #58 defined *who does what*, #61 enforced *what gates exist*, but nothing bounds **how
long a session runs / how large context grows** — the dominant variable.

## Decisions & trade-offs

- **Bounded sessions over marathon sessions.** Apply the spine's "disposable-but-durable" rule to
  satellites: checkpoint to the dev-log, continue fresh. Enforced softly via a `Stop` **turn-count
  nudge** (hooks can't read context size, so turn count is the proxy) at ~40/70/100 turns —
  non-blocking, because a hook can't force a new session and false-blocking would be worse.
- **High-level issues are correct input; planning must decompose them.** Per the user (note 2):
  they write issues high-level on purpose. The fix is a planner **"Decisions to confirm"** output
  — surface the issue's embedded decisions as questions for the user *before* code — not "write
  more detailed issues." Under-surfaced decisions are what made #15 discover scope mid-flight.
- **Delegation must actually offload**, and **narration is a real cost** (~1,300 tok/text-only
  msg; continuous dev-log churn is narration too) — encoded as prose rules in the `delegate` skill
  rather than hooks (blocking source edits on feature branches would break legitimate Tier 0 work).
- **Arc-branch tier** (folded in mid-#66). A multi-issue arc now gets its own long-lived
  integration branch `arc/<slug>` off develop: per-issue `feature/*` branches nest under it and PR
  *into the arc*; the arc merges to develop only when the whole effort is complete, so develop
  stays clean of half-done arc work. Wave sub-branches are unchanged (still nested under a feature
  branch). The two guardrails learn the tier: `block_source_edits` treats `arc/*` as protected
  (source denied, `docs/`+`.claude/` writable so the spine edits the arc-log directly on the arc
  branch), and `session_start_role_check` casts an `arc/*` window as the **arc spine**. PR routing
  is a documented convention (target the arc branch when one exists, else develop) — no
  auto-detection (YAGNI). First real arc on merge: the remainder of **Milestone 1 "Local-First
  Rework"**; its planning is deferred to that point.

## Rejected approaches

- **Blaming Fable.** #47 ran *more* Fable than #15 and was less bad; #61's model pin stays but is
  not the fix. Context saturation is.
- **A hook that hard-blocks long sessions.** Hooks can't measure context and can't start a new
  session; a hard block would misfire. Nudge + prose instead.
- **"Write more detailed issues."** Rejected per note 2 — the planning stage is the right place to
  decompose.

## Retrospective

Shipped in two parts. **Part 1 (planned):** the session-shape fixes — a `Stop` session-budget
nudge (turn-count proxy at ~40/70/100), the bounded-session/real-delegation/trim-narration prose
in the `delegate` skill, the planner "Decisions to confirm" step, and the dev-log two-checkpoint
rule. **Part 2 (folded in mid-cycle):** the **arc-branch tier** — a request that surfaced while
designing a cross-repo requirements workflow (the Lodestar three-role/arc-spine model). A
multi-issue arc now gets its own `arc/<slug>` integration branch; feature branches nest under it
and PR into the arc, so develop stays clean until the effort completes.

Notably, the arc-branch work **dogfooded Part 1's own lessons**: scope was gated and agreed in the
user's words before any edit (three embedded decisions surfaced as explicit questions), the two
guardrail hooks were changed by the orchestrator directly (surgical, safety-critical) and
behaviorally verified on a throwaway `arc/` worktree, and only the verbose doc/skill prose was
delegated to the scribe — a deliberately small agent footprint, not a wave.

Deferred by design: the first real arc (remainder of Milestone 1, "Local-First Rework") stands up
only **after this PR merges**, because the `arc/*` hook support must be on develop before an arc
branch is recognized. The broader Star/three-role automation stays a Lodestar-side design thread,
not TimeScope scope.
