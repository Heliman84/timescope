---
name: delegate
description: TimeScope delegation playbook — use when orchestrating any non-trivial work: deciding what to delegate vs do inline, spawning project agents, running parallel worktree waves, or assembling an F5 packet. Referenced by the feature loop.
---


# Delegation Playbook (the orchestrator is this chat)

The main thread holds **decisions, user gates, briefs out, packets back** — nothing verbose.
Exploration transcripts, test output, diff analysis, and doc drafting live in subagents that
return conclusions. This playbook is standing authorization to spawn the agents in
`.claude/agents/` per the tiers below without asking first.


## Tiers — how much to delegate

| Tier | When | What happens |
| :--- | :--- | :--- |
| **0 — inline** | Single-file or trivial change, quick question, known territory | No agents. Just do it. |
| **1 — standard** | One coherent slice, multi-file | scout for any exploration beyond known files; build inline or via one builder; **reviewer + verifier always run at pre-PR**; scribe drafts docs |
| **2 — wave** | ≥2 tracks with **disjoint file sets** | planner partitions tracks → one builder per track in its own worktree → sub-branch PRs into the feature branch (below) |

When in doubt, Tier 1. Disjointness is the go/no-go for Tier 2 — overlapping tracks run
sequentially as Tier 1 instead (parallel agents on shared files burn tokens and create merge pain).


## Roster

| Agent | Model | Effort | Spawn when |
| :--- | :--- | :--- | :--- |
| scout | sonnet | medium | "where/how/why" questions, impact sweeps, bug root-cause |
| architect | opus | high | arc-level design or structural trade-offs — returns an options study; the **decision** happens here with the user |
| planner | opus | high | turning agreed scope into slices/tracks with tests and merge order |
| builder | sonnet | medium | implementing a specified slice: domain, storage, Runtime, commands |
| ui-builder | sonnet | medium | implementing in `src/dashboard/webview/` + `tests/webview/` |
| reviewer | opus | medium | adversarial diff review (generic + TimeScope invariants) |
| verifier | sonnet | low | the mechanical pre-PR gate; assembles the F5 packet; leaves the checkout F5-ready |
| scribe | sonnet | low | dev-log / arc / CHANGELOG / PR body drafts; wiki curation + lint |

Model override at spawn is allowed (e.g. haiku for a trivially mechanical one-off).


## Briefs down, packets up

- A brief is **self-contained**: goal, done-criteria, exact files/dirs, the constraints that
  apply (immutability, no new deps, snake_case…), and "read `.claude/wiki/index.md` first,
  then the pages your role names."
- Agents return their fixed packet format (defined in each agent file) — conclusions with
  `file:line` refs, never raw file dumps or full test transcripts.
- **Continue, don't respawn**: send reviewer findings back to the *owning* builder via
  SendMessage (its context is intact); a fresh spawn re-pays cold start.
- If the main thread finds itself pasting raw tool output into its own analysis, that work
  belonged in an agent.


## Wave mechanics (Tier 2)

Sub-branch naming: **`feature/issue-<N><letter>--<slug>`** — letter `a/b/c…` in the
planner's merge order (e.g. `feature/issue-47a--multi-instance`). The letter rides next to
the issue number so truncated branch lists stay tellable-apart; the core feature branch has
no letter. (Git refs can't nest under an existing branch name, so `<feature-branch>/<track>`
is invalid.) The planner's Tracks section + the sub-PR title record which track each letter is.

1. Feature branch exists; planner has returned disjoint tracks + merge order.
2. Per track: `git worktree add ../ts-<N><letter> -b feature/issue-<N><letter>--<slug> feature/issue-<N>-<slug>`
   — the user never opens these; they are just directories agents work in.
3. Builder implements + self-verifies in its worktree, returns a build packet with draft F5 notes.
4. Reviewer reviews the track diff; findings bounce back to that builder; re-verify.
5. Push; `gh pr create --base feature/issue-<N>-<slug> --label track` (create the `track`
   label once if missing). Orchestrator merges sub-PRs in the planner's order.
6. After the last merge: verifier gates the **assembled** feature branch and assembles the
   single F5 packet; remove worktrees (`git worktree remove ../ts-<track>`).
7. Normal F5 handoff, then one feature→develop PR on request.

The user touches three points only: scope agreement, F5 on the assembled branch, the final PR.


## F5 packet (who writes the user's instructions)

Builders draft per-slice notes → **verifier** assembles one packet and verifies the checkout
matches it (compile clean, suites green, fixtures staged in `test-workspace/global-storage/`,
settings pinning intact) → the **orchestrator** delivers it, owning the final wording and the
bold mission header (feature skill §6). Orchestrator-voiced, verifier-verified.


## Wiki protocol (`.claude/wiki/`)

- Every agent reads `index.md` first, then the pages its definition names — explore only the delta.
- **Update triggers:** after a scout sweep that produced reusable knowledge, and at PR time
  (scribe asks: *what did this branch learn that a future agent would otherwise re-derive?*).
- **Lint** (scribe, at PR time): index rows resolve and blurbs are current; each page holds its
  ~200-line budget — prune before appending. Wrong-turn diagnoses stay on record as corrections
  (they prevent repeat misdiagnoses).
- Provenance is the wiki files' git history — there is no separate activity log.


## Arc mode (the issue belongs to a multi-issue arc)

When `docs/arc-log/` lists the issue, the arc log is the north star — read it before the
issue and keep the user oriented in the forest, not just the trees:

- **Breadcrumb every user-facing status and F5 handoff:** open with
  `Arc <slug> — wave X/Y — issue #N (<track>)` before anything else.
- At arc kickoff: architect study → north-star architecture + build order decided in the
  main thread → recorded in the arc log.
- At each issue's PR: scribe updates the arc status table (issue → dev-log → PR) and states
  what the next wave is gated on.
- A wave starts only when the prior wave's PRs are merged; the arc log's build order names
  the highest-collision files and which track owns them each wave.


## Never delegated

Scope agreement, F5 verification, PR merges, anything touching `package.json`, and version
bumps stay in the main thread with the user.
