# Issue #66 — Process refinement (mid-cycle retrospective on wave 3)

> Decision log, not a spec. Written at two checkpoints — plan-time and PR-time.

**Issue:** [#66](https://github.com/Heliman84/timescope/issues/66)  ·  **PR:** TBD  ·  **Follows:** [#58](https://github.com/Heliman84/timescope/issues/58), [#61](https://github.com/Heliman84/timescope/pull/61)

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

## Rejected approaches

- **Blaming Fable.** #47 ran *more* Fable than #15 and was less bad; #61's model pin stays but is
  not the fix. Context saturation is.
- **A hook that hard-blocks long sessions.** Hooks can't measure context and can't start a new
  session; a hard block would misfire. Nudge + prose instead.
- **"Write more detailed issues."** Rejected per note 2 — the planning stage is the right place to
  decompose.

## Retrospective

_To be filled at PR time._
