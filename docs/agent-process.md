# TimeScope Agent Process

> The human-readable reminder of how development runs here: one orchestrator chat, eight
> project agents, three delegation tiers. The operational playbook agents follow is the
> [`delegate` skill](../.claude/skills/delegate/SKILL.md); the portable version for seeding
> other repos is [agent-process-foundation.md](agent-process-foundation.md).


## The shape

The main chat is the **orchestrator** — it holds decisions, user gates (scope, F5, PR
merges), and briefs/packets. Everything verbose runs in project agents that return
conclusions, never transcripts.

```mermaid
flowchart TD
    U([You]) <-->|scope · F5 · PR merges| O[Orchestrator = main chat<br/>briefs out, packets back]
    O --> SC[scout<br/>sonnet · recon]
    O --> AR[architect<br/>opus · design studies]
    O --> PL[planner<br/>opus · slices & tracks]
    O --> B[builder / ui-builder<br/>sonnet · TDD slices]
    O --> RV[reviewer<br/>opus · adversarial review]
    O --> VF[verifier<br/>sonnet · gate + F5 packet]
    O --> SB[scribe<br/>sonnet · docs + wiki]
    W[(.claude/wiki/<br/>curated knowledge)] -.->|read first| SC & AR & PL & B & RV & VF
    SB -.->|curates| W
```

**Models by judgment density:** opus only where mistakes are expensive to unwind (architect,
planner — effort high; reviewer — medium); sonnet carries the token bulk (scout, builders
medium; verifier, scribe low). The orchestrator itself runs on opus — after delegation it is
the lowest-volume, highest-judgment context in the system.


## The tiers

| Tier | When | Flow |
| :--- | :--- | :--- |
| 0 — inline | single-file/trivial | no agents |
| 1 — standard | one coherent slice | scout explores → build (inline or one builder) → reviewer + verifier gate → scribe documents |
| 2 — wave | ≥2 disjoint-file tracks | planner partitions → parallel builders in worktrees → sub-branch PRs into the feature branch → verifier gates the assembled branch |


## A Tier 2 wave, end to end

```mermaid
flowchart LR
    S[Scope agreed<br/>feature branch] --> P[planner:<br/>disjoint tracks<br/>+ merge order]
    P --> T1[builder in worktree<br/>…--storage]
    P --> T2[ui-builder in worktree<br/>…--webview]
    T1 --> R1[reviewer → fixes] --> PR1[sub-PR into<br/>feature branch]
    T2 --> R2[reviewer → fixes] --> PR2[sub-PR into<br/>feature branch]
    PR1 & PR2 --> V[verifier: gate the<br/>assembled branch<br/>+ F5 packet]
    V --> F5([You: one F5]) --> PR([One PR → develop])
```

Sub-branches are `feature/issue-<N><letter>--<slug>` (letter = merge order, e.g.
`feature/issue-47a--multi-instance`, labeled `track`) — the letter sits next to the issue
number so truncated branch lists stay readable, and the letterless branch is always the core
feature branch. You never open the worktrees. You touch three points: scope, one F5 on the
assembled branch, the final PR.


## An arc, end to end (multi-issue efforts)

An arc (like local-first storage: local-first → multi-instance → hierarchical jobs) is waves
of feature loops under one spine — the arc log. The orchestrator's job is to keep you
oriented: **every status update and F5 handoff during an arc opens with the breadcrumb**
`Arc <slug> — wave X/Y — issue #N (<track>)`, so you always know where in the forest you are.

```mermaid
flowchart TD
    K[Arc kickoff<br/>architect study → you decide] --> AL[(arc log<br/>north star · build order<br/>live status table)]
    AL --> W1[Wave 1<br/>issues run as feature loops<br/>tracks in parallel]
    W1 --> G1{wave PRs<br/>merged} --> S1[scribe: status table<br/>+ next wave's gate]
    S1 --> W2[Wave 2 …] --> G2{…}
    G2 --> C[Arc close<br/>retrospective → wiki]
    AL -.->|breadcrumb on every<br/>handoff & status| YOU([You])
```

The rhythm per wave: planner partitions the wave's issues into tracks (the arc log names the
highest-collision files and which track owns them) → feature loops run, possibly Tier 2 →
each PR updates the arc status table via scribe → the next wave starts only when this wave's
PRs are merged. Getting lost mid-arc should never require re-reading PRs — the arc log's
status table plus the breadcrumb is the recovery path.


## Who writes what you read

Builders draft per-slice F5 notes → **verifier** assembles the single F5 packet and leaves
the checkout F5-ready (fixtures staged, suites green) → the **orchestrator** delivers it with
the bold mission header. Scribe drafts dev-log/CHANGELOG/PR bodies for orchestrator edit, and
curates the wiki at PR time (what did this branch learn? prune to budget, lint the index).


## Never delegated

Scope agreement · F5 verification · PR merges · `package.json` changes · version bumps.
