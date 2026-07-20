# Issue #60 — Process hardening: enforced guardrails for the arc/agent process

> Decision log, not a spec. Started at plan time, finalized as a retrospective at PR time.
> Keep it short — capture the *why*, not a blow-by-blow.

**Issue:** [#60](https://github.com/Heliman84/timescope/issues/60)  ·  **PR:** TBD  ·  **Follows:** [#56](https://github.com/Heliman84/timescope/issues/56)

## Problem

Wave 3 of the local-first arc exposed that the #56 agent/arc process was **advisory prose with
no enforcement**. Two satellite windows ran their feature loops but: ran the main chat on
**Fable at high effort** (top tier) doing bulk work inline instead of delegating to the
model-pinned agents; **skipped scope agreement** entirely; and **handed off for F5 without
staging the test environment**, so the user opened onto broken/empty fixtures. Each is the same
failure — an advisory rule wasn't followed and nothing caught it. Cost the user ~10 hours and a
full session budget.

## Decisions & trade-offs

- **Enforce with hooks, not more prose.** The root cause was that nothing *checked* the rules,
  so the fix is mechanical checks in `.claude/settings.json` + `.claude/hooks/`. The user
  explicitly prefers rigid, must-follow process over advisory guidance.
- **Model: pin `opus` default + a SessionStart warning.** Project settings beat user settings,
  so a `model: opus` default means a freshly opened window here starts on opus regardless of the
  user's personal default; `/model` still overrides for deliberate cases. The pin alone is
  silent, so a `SessionStart` hook (which *does* receive the model name) also flags a
  Fable/non-opus main window and casts the window's role (spine vs orchestrator). Caveat: the
  pin is read at session start, so it only reaches **newly opened/restarted** windows.
- **Branch guard denies *source* on develop/main, not everything.** `src/`, `tests/`,
  `package.json`, `tsconfig*` are blocked; `docs/` and `.claude/` stay writable so the spine can
  maintain the arc log and process files on develop (and so this very branch could be built).
  Chose `deny` over `ask` for source (there is never a good reason) — the user picked this.
- **F5 gate is receipt-based, not a filesystem heuristic.** There are four fixture workspaces
  and their `global-storage/` is gitignored (a fresh worktree is empty), and `-empty` is
  *supposed* to be empty — so no single "is it populated?" check is correct. Instead staging
  must stamp `.claude/.f5-ready.json` (pinned to HEAD) via `f5_receipt.js`, and the `Stop` hook
  blocks any F5-handoff-shaped final message without a fresh receipt. This makes "I staged the
  env" an attestation the gate enforces, and it's feature-agnostic.
- **Hooks are Node, not bash.** Portable on the user's Windows/PowerShell setup with no jq/bash
  dependency; Node is already a project requirement. All fail **open** — a guardrail bug must
  never brick a session or block all edits.
- **The orchestrator's own mistake is fixed too.** The spine's satellite starter prompts had
  pre-baked the scope and said "run the feature loop," which reads as "go implement" and skips
  the gate. New spine prompt rules: breadcrumb only, cast the chat as orchestrator, never
  pre-decide scope, name the non-negotiables.

## Rejected approaches

- **Prose-only hardening** — same advisory approach that just failed.
- **`ask`-on-every-edit branch guard** — nags on every legitimate doc/arc-log edit the spine
  makes on develop.
- **F5 gate that checks `global-storage` is non-empty** — wrong for the deliberately-empty
  opt-in fixture and blind to which of the four workspaces a feature uses.

## Retrospective

_To be filled at PR time._ Built and verified all three hooks against sample stdin (model
fable/opus; branch guard deny-source/allow-docs on develop vs allow-on-feature; F5 gate
allow-normal / block-unstaged / allow-after-receipt / block-stale). Prose backstops landed in
the `delegate` and `feature` skills, the `verifier` agent, `agent-process.md`, and `CLAUDE.md`.
