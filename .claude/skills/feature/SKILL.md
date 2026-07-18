---
name: feature
description: TimeScope feature loop — use when discussing a GitHub issue, starting a feature or bugfix, implementing a change, or creating a PR to develop. Covers branch creation, planning, TDD implementation, F5 handoff, and PR creation.
---

# Feature Loop (issue → PR → develop)

The durable record is the GitHub issue + the PR description + a short `docs/dev-log/` decision log. No heavyweight up-front spec files.

## 1. Discuss

- If an issue number is given: `gh issue view <N>` (add `--comments` if there's discussion). Restate the problem in your own words; discuss until scope is agreed.
- If there is no issue yet: discuss the idea, then draft a short issue (problem, desired behavior, acceptance notes) and file it with `gh issue create` after the user confirms the text.

## 2. Branch

Only after scope is agreed:

```
git checkout develop && git pull
git checkout -b feature/issue-<N>-<short-slug>
```

## 3. Plan

Plan in conversation (use plan mode for non-trivial changes). Identify exact files, tests, and any impact on: the session state machine, the dashboard/webview, data formats (`docs/record_format_spec.md`), or commands/settings in `package.json` (needs explicit approval).

Start the dev log now: copy [docs/dev-log/TEMPLATE.md](../../../docs/dev-log/TEMPLATE.md) to `docs/dev-log/issue-<N>-<short-slug>.md` and fill in the problem + the scope decisions and trade-offs as they're agreed. It's a living decision log through implementation, not a spec — keep it short.

## 4. Implement

- TDD: write/extend tests in `src/test/` first (plain throwing functions, registered in `run_tests.ts`), then implement.
- Dashboard/webview changes: extend the Playwright suite in `tests/webview/` (harness stubs `acquireVsCodeApi`; fixtures mirror `buildPayload`). While iterating on UI you can also drive the harness live with the Playwright MCP tools and show the user screenshots instead of requiring F5 for every tweak.
- Iterate until `npm test` is green and `npm run compile` is clean; `npm run test:ui` green whenever `src/dashboard/webview/` or `tests/webview/` changed.
- Follow CLAUDE.md conventions; no new dependencies without approval.

## 5. Pre-PR checklist (all must pass before handoff)

- [ ] `npm test` green, `npm run compile` clean
- [ ] Working tree committed, no stray file changes
- [ ] No new dependencies; `package.json` untouched beyond the confirmed version bump and any explicitly approved changes (e.g. new command contributions) — verify mechanically: `git diff origin/develop...HEAD -- package.json package-lock.json` shows only the confirmed bump and/or explicitly approved changes
- [ ] Review `git diff --stat origin/develop...HEAD` for stray files that don't belong to this feature
- [ ] `docs/processes.md` diagrams updated if architecture/state machine/data format changed
- [ ] `/code-review` run on the diff; findings fixed or explicitly waived by the user. Beyond generic review, verify the TimeScope domain invariants:
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
