---
name: feature
description: TimeScope feature loop — use when discussing a GitHub issue, starting a feature or bugfix, implementing a change, or creating a PR to develop. Covers branch creation, planning, TDD implementation, F5 handoff, and PR creation.
---

# Feature Loop (issue → PR → develop)

The durable record is the GitHub issue + the PR description + a short `docs/dev-log/` decision log. No heavyweight up-front spec files.

**Delegation:** this loop runs on the tiers in the `delegate` skill — decide the tier at plan
time. The main thread orchestrates; scout/planner/builders/reviewer/verifier/scribe do the
verbose work and return packets. Tier 0 (single-file/trivial) skips agents entirely.

## 1. Discuss

- If an issue number is given: `gh issue view <N>` (add `--comments` if there's discussion). Restate the problem in your own words; discuss until scope is agreed.
- Unfamiliar territory → spawn **scout** for the recon instead of exploring inline. Structural
  implications (state machine, storage model, data formats) → spawn **architect** for an
  options study to anchor the discussion; the decision stays here with the user.
- If there is no issue yet: discuss the idea, then draft a short issue (problem, desired behavior, acceptance notes) and file it with `gh issue create` after the user confirms the text.

## 2. Branch

**Scope gate — a hard STOP.** Do not create the branch, spawn a builder, or edit source until
the user has agreed the scope *in response to your restatement of it*. Restating the issue back
to yourself is not agreement; a starter prompt that arrived with scope pre-baked is not
agreement. If you are in a satellite window that opened straight onto an issue, treat scope as
**not yet agreed** and get it before proceeding. Skipping this gate is what over-ran a whole
session budget on mis-scoped work.

Only after scope is agreed:

```
git checkout develop && git pull
git checkout -b feature/issue-<N>-<short-slug>
```

A PreToolUse hook blocks source edits on `develop`/`main`, so being on the feature branch is
also mechanically required before implementation — but the branch is downstream of the gate,
not a substitute for it.

## 3. Plan

Plan in conversation (use plan mode for non-trivial changes). Identify exact files, tests, and any impact on: the session state machine, the dashboard/webview, data formats (`docs/record_format_spec.md`), or commands/settings in `package.json` (needs explicit approval).

Multi-file scope → spawn **planner** for the slice/track plan and pick the tier: ≥2 disjoint
tracks → Tier 2 wave (worktrees + sub-branch PRs into the feature branch — mechanics in the
`delegate` skill); otherwise Tier 1.

Start the dev log now: copy [docs/dev-log/TEMPLATE.md](../../../docs/dev-log/TEMPLATE.md) to `docs/dev-log/issue-<N>-<short-slug>.md` and fill in the problem + the scope decisions and trade-offs as they're agreed. It's a living decision log through implementation, not a spec — keep it short.

## 4. Implement

- **Delegate the bulk; don't build inline.** Implementation is the agents' job — the
  orchestrator window is high-tier (opus, sometimes higher) and expensive, and doing the
  token-heavy work there instead of in a sonnet builder is what ran a session dry. Beyond a
  Tier 0 one-liner, hand slices to a builder.
- Tier 1+: delegate slices to **builder** (core) / **ui-builder** (webview); Tier 2 runs them
  in parallel worktrees per the `delegate` skill. Builders self-verify and return build
  packets with draft F5 notes; review findings bounce back to the owning builder.
- TDD: write/extend tests in `src/test/` first (plain throwing functions, registered in `run_tests.ts`), then implement.
- Dashboard/webview changes: extend the Playwright suite in `tests/webview/` (harness stubs `acquireVsCodeApi`; fixtures mirror `buildPayload`). While iterating on UI you can also drive the harness live with the Playwright MCP tools and show the user screenshots instead of requiring F5 for every tweak.
- Iterate until `npm test` is green and `npm run compile` is clean; `npm run test:ui` green whenever `src/dashboard/webview/` or `tests/webview/` changed.
- Follow CLAUDE.md conventions; no new dependencies without approval.

## 5. Pre-PR checklist (all must pass before handoff)

Tier 1+: **verifier** runs the mechanical items and stages F5 readiness; **reviewer** runs the
review item; **scribe** drafts the doc items. The orchestrator confirms the packets and owns
the user-gated items (version bump, waivers).

- [ ] `npm test` green, `npm run compile` clean
- [ ] Working tree committed, no stray file changes
- [ ] No new dependencies; `package.json` untouched beyond the confirmed version bump and any explicitly approved changes (e.g. new command contributions) — verify mechanically: `git diff origin/develop...HEAD -- package.json package-lock.json` shows only the confirmed bump and/or explicitly approved changes
- [ ] Review `git diff --stat origin/develop...HEAD` for stray files that don't belong to this feature
- [ ] `docs/processes.md` diagrams updated if architecture/state machine/data format changed
- [ ] **reviewer** agent run on the diff (or `/code-review` at Tier 0); findings fixed or explicitly waived by the user. Beyond generic review, verify the TimeScope domain invariants:
  - Domain objects stay immutable (mutations return new instances; only `Runtime` mutates)
  - Timestamps remain monotonic per job log (`ensureAfter` on any appended/retimed event)
  - Event dedup by ID is preserved (no path writes an event twice across global/workspace logs)
  - Session state machine transitions stay legal (start→pause/stop, pause→resume/stop; validated, not assumed)
  - JSONL canonical field order and format version header untouched unless the spec docs change too
- [ ] Propose a version bump (patch/minor per [coding_standards.md](../../../coding_standards.md) Versioning rules) with the explicit `from → to`; on user confirmation, edit `package.json`'s `version` and include it in the PR. Never bump silently.
- [ ] One line added to `CHANGELOG.md` under **Unreleased**
- [ ] `docs/dev-log/issue-<N>-<slug>.md` finalized: retrospective filled in (what actually shipped, any changes from the plan), issue/PR links set

## 6. Hand off for F5

**Default to feature-complete testing.** The user prefers to F5 **once, when the whole issue's scope works end-to-end** — not at each intermediate slice (testing half-built states wastes their time). When an issue is sliced, keep building toward feature-complete and self-verify each slice yourself (test suite, the `run`/`verify` skills, driving the flow). Only request an intermediate F5 when you genuinely need a second set of eyes — and say so explicitly ("I need your eyes on X because …"). See the `user-testing-cadence` memory.

When you do hand off, STOP and tell the user the branch is ready. Do NOT create the PR until they ask.

The handoff content comes from the F5 packet: builders draft per-slice notes → **verifier**
assembles one packet and leaves the checkout F5-ready → the orchestrator delivers it in the
user's terms (below).

**The F5 environment must actually be staged, not assumed.** A fresh worktree's
`global-storage/` is empty (gitignored), so the verifier populates the fixture workspace the
steps use and stamps a receipt (`node .claude/hooks/f5_receipt.js …`). A Stop hook blocks the
handoff until that receipt exists for the current commit — so "I set up the test environment"
is enforced, not promised. Never hand off telling the user to F5 an environment you have not
staged and looked at.

**Every F5 handoff must open with a context header** so the user doesn't have to reconstruct where we are:

- First line: **`Step X/N — <mission in ≤15 words>`** in bold (X/N only if the work is sliced; otherwise just the bold mission line).
- Then the concrete test steps.

The mission line states what *this* handoff is testing, in the user's terms. Example: **`Step 1/3 — confirm .timescope is opt-in and no folder is created until you say yes`**. Put this ABOVE any large "how to test" header — a big header with no orientation above it has burned the user's time before.

Do NOT create the PR until they ask.

## 7. Create the PR (on request)

```
git push -u origin <branch>
gh pr create --base develop --title "<concise title>" --body "<description>"
```

Description: summary, user-facing behavior, technical changes, `Closes #<N>`, and a link to the `docs/dev-log/` entry. Include a small mermaid diagram when structure changed. Keep it short and readable — no boilerplate sections that don't apply.

## 8. After merge (offer, don't assume)

Delete the local + remote feature branch, `git checkout develop && git pull`.
