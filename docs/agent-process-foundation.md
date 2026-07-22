# Agent-Driven Development — Portable Foundation

> A self-contained model for running Claude Code development with a lean orchestrator thread
> and a roster of model-pinned subagents. Written to be **ingested into a new repository**
> (firmware, analysis Python, web, robotics, computer vision, …) and tuned there. The
> TimeScope-tuned instance of this model lives in [agent-process.md](agent-process.md),
> `.claude/agents/`, `.claude/wiki/`, and the `delegate` skill.


## Part 1 — The invariant core (keep these in every repo)


### 1. The orchestrator is the main chat thread, not an agent
Subagents cannot converse with the user, so decisions and user gates can only live in the
main thread. Defining an "orchestrator agent" adds a hop to every decision and detaches it
from the gates. The main thread holds: scope agreement, the human verification gate, merges,
briefs out, packets back — and nothing verbose.


### 2. Model + effort by judgment density, not prestige
Most tokens in a feature are mechanical (searching, generating code, running tests) —
run them on a mid-tier model (sonnet). Judgment moments are low-token but expensive to get
wrong — run them on the top model (opus) with high reasoning effort. Spend thinking tokens
where mistakes are expensive to *unwind* (plans, architecture), not where output is
mechanically checkable (builds caught by tests, checklist gates). The orchestrator runs on
the top model: post-delegation it is the lowest-volume, highest-judgment context.


### 3. Briefs down, packets up
Briefs are self-contained (goal, done-criteria, files, constraints, "read the wiki index
first"). Agents return a **fixed-format packet** — conclusions with `file:line` refs, bounded
length — never transcripts or file dumps. Continue an agent via SendMessage instead of
respawning (context intact, no cold start). Litmus test: if the main thread is pasting raw
tool output into its own analysis, that work belonged in an agent.


### 4. Delegation tiers
- **Tier 0 — inline:** single-file/trivial. Agents would be pure overhead.
- **Tier 1 — standard:** exploration, review, verification, and doc drafting are delegated;
  one builder or inline implementation.
- **Tier 2 — wave:** planner partitions **disjoint-file** tracks; one builder per track in
  its own git worktree; sub-branch PRs into an integration (feature) branch; merge in planned
  order. Disjointness is the go/no-go — overlap means sequential.
  Sub-branch naming: letter-index the tracks next to the issue number in merge order
  (e.g. `feature/issue-47a--<slug>`) — the differentiator survives truncated branch lists,
  the letterless branch is always the integration branch, and git refs can't nest under an
  existing branch name so a `<feature-branch>/<track>` form is invalid anyway.


### 5. The human gate
Every domain has a verification step only the human can run. Agents build + self-verify +
return a draft "gate packet"; a verifier agent assembles one packet and leaves the
environment ready; the orchestrator delivers it with a one-line mission header in the user's
terms. One gate per feature-complete state — not per slice.


### 6. The agent wiki (`.claude/wiki/`)
Distilled operational knowledge every agent reads before exploring — so exploration cost
compounds *down* across sessions. Six pages: `index.md` (router + team table), `arch.md`,
`contracts.md`, `ops.md`, `testing.md`, `gotchas.md`. Rules that keep it healthy:
- ~200-line budget per page; **prune before appending**; a ≤20-word human blurb tops each page
- Seeded once by a scout sweep; updated after sweeps and at PR time ("what would a future
  agent otherwise re-derive?"); linted at PR time (index rows resolve, budgets held)
- Wrong-turn diagnoses stay on record as corrections — they prevent repeat misdiagnoses
- Provenance = git history (no separate activity log)


### 7. Arcs — multi-issue campaigns need a spine and a breadcrumb
When an effort spans multiple issues, per-issue records aren't enough — the human loses the
forest in the trees. Four mechanisms fix that:
- **An integration branch above the feature branch**: a multi-issue arc gets its own
  long-lived `arc/<slug>`, branched off the mainline integration branch. Per-issue feature
  branches nest under it and PR *into the arc*, not the mainline — the arc merges to the
  mainline only when the whole effort is complete, so the mainline stays clean of half-done
  arc work:
  ```text
  develop → arc/<slug> → feature/issue-<N>-<slug> → feature/issue-<N><letter> (waves)
  ```
  The arc spine window (below) is coordination-only on `arc/<slug>`, same as on the mainline
  branches — no source edits there.
- **A spine document** (an "arc log"): the north-star architecture (decided in the main
  thread from an architect study), the wave-by-wave build order naming the highest-collision
  files and their owning track, and a live status table (issue → decision log → PR). The
  scribe updates it at every PR; the next wave starts only when the current wave's PRs merge.
- **A breadcrumb ritual**: during an arc, every user-facing status update and gate handoff
  opens with `Arc <slug> — wave X/Y — issue #N (<track>)`. Recovery from "where were we?"
  is reading the spine's status table, never re-reading PRs.
- **Spine & satellite sessions (window scale)**: host the spine chat in the primary IDE
  window on the integration branch (the arc branch during an arc, else the mainline) —
  coordination only, it never edits source; its state is
  the spine document, so any fresh session rehydrates in one read (disposable-but-durable).
  Per issue the spine dispatches either an **in-spine agent wave** (well-specified work) or a
  **satellite window** on its own worktree + session (human-heavy work — it gets the human
  gate locally). Sessions communicate only through durable records; the handoff into a cold
  satellite session is a one-line starter prompt the spine writes and the human pastes.


### 8. The roster archetypes

| Archetype | Model / effort | Mission | Notes |
| :--- | :--- | :--- | :--- |
| scout | mid / med | recon + root-cause, read-only, packet ≤30 lines | |
| architect | top / high | options studies for main-thread decisions | decides nothing |
| planner | top / high | slices, tests-first, track partitioning + merge order | |
| builder ×N | mid / med | TDD implementation of a specified slice | one per toolchain track |
| reviewer | top / med | adversarial diff review + domain invariants checklist | finds, never fixes |
| verifier | mid / low | mechanical gate checklist + human-gate packet + env staging | |
| scribe | mid / low | doc drafts + wiki curation/lint + diagram quality checklist | |

Agent files: `.claude/agents/<name>.md`, frontmatter `name, description` (drives
auto-delegation — include "use proactively"), `tools` (comma list; omit = all), `model`
(alias), `effort` (low…max), `color`. Keep bodies terse: wiki-read line, Role, rules, Output
packet format (~40 lines).


## Part 2 — Tuning to a new domain (what to swap)

| Knob | VS Code extension (TimeScope) | Firmware | Analysis Python | Web app | Robotics / CV |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Human gate | F5 extension host | hardware-in-loop bench | result review on real data | staging walkthrough | field/bench trial |
| Second builder track | webview + Playwright | driver/HAL crates vs app logic | pipeline vs notebook/viz | frontend vs API | perception vs control |
| `contracts.md` holds | message protocol, JSONL formats | register maps, wire protocols | data schemas, file formats | API schemas, DB migrations | topic maps, calibration formats |
| Verifier gate | compile + 2 suites + fixture staging | cross-compile + host tests + flash artifacts | pipeline run + data validation | build + e2e + migrations | sim run + rosbag replay |
| Reviewer invariants | immutability, event dedup, state machine | ISR safety, register layouts, timing | data lineage, reproducibility | authz, migrations, input validation | frame/timing budgets, coordinate frames |
| Release qualification | vsix install smoke, property/fuzz tests, corpus replay | HIL soak, power cycling | full-corpus rerun | load + security pass | endurance runs |

Constant across domains: the tiers, briefs/packets, wiki mechanics, model/effort mapping,
worktree waves, and the human gate pattern.


## Part 3 — Seeding checklist for a new repo

1. Copy `.claude/agents/` + the `delegate` skill; rename domain-specific nouns (builders,
   gate name, invariants list) per the tuning table.
2. Run a one-time scout sweep ("very thorough") → seed the six wiki pages from its packet.
3. Add the short "Agent delegation" section to the repo's CLAUDE.md (tiers + standing spawn
   authorization + wiki-first rule + never-delegated list).
4. Wire delegation points into the repo's workflow skills (discuss/plan/implement/gate).
5. Define the verifier's gate checklist from the repo's real build/test commands.
6. Shakedown on the next real issue; tune packet formats from what actually comes back;
   fold learnings into the wiki.
