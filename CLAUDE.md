# TimeScope — Claude Project Guide

VS Code extension for tracking consulting hours: start/pause/resume/stop work sessions from the status bar, with a webview analytics dashboard. Domain-driven design with immutable objects (`Event`, `Job`, `Session`), repositories for file I/O, and one mutable coordinator (`Runtime`). Architecture diagrams: [docs/processes.md](docs/processes.md). Data formats: [docs/record_format_spec.md](docs/record_format_spec.md).


## Commands

- `npm run compile` — TypeScript → `out/`
- `npm test` — compile + run the pure-Node test suite (`src/test/run_tests.ts`; no VS Code host needed)
- `npm run test:ui` — Playwright tests for the dashboard webview (`tests/webview/`; offline, Chart.js vendored, `acquireVsCodeApi` stubbed). Required when touching `src/dashboard/webview/`
- `npm run package` — build the `.vsix` (prepublish + vsce)
- **F5** (user-only) — Extension Development Host opening `test-workspace/`, whose `.vscode/settings.json` pins TimeScope storage to `test-workspace/global-storage/` so dev testing never touches real tracking data


## Branch model

- `develop` — integration branch, default PR target
- `main` — releases only (reached via release PRs from develop)
- Feature branches: `feature/issue-<N>-<slug>` off develop
- Hotfixes: branch off `main`, PR to main, then merge main back into develop


## Agent process controls

- Before the first file edit in any work session, confirm `git branch --show-current` is not `develop` or `main`. Re-check if the branch may have changed since the last check (e.g. after a checkout, merge, or a gap in the conversation).
- When a clarifying question offers specific options and the user answers with free text that doesn't match one of them ("Other"), that is **not** consent to any of the listed options — it means none of them fit. Treat the question as still open: restate what changed based on their input and ask again explicitly before taking the action the question was gating.


## Workflow

Chat-driven loops, each a skill in `.claude/skills/`:

| Loop | Skill | Trigger |
| :--- | :--- | :--- |
| Feature (issue → PR) | `feature` | discussing/working a GitHub issue |
| Install latest develop build | `install` | "install the latest build" |
| Release develop → main | `release` | "do a release" |
| Delegation playbook | `delegate` | orchestrating any Tier 1+ work (referenced by the loops) |


## Agent delegation

The main chat thread is the **orchestrator**: decisions, user gates (scope, F5, PR merges),
briefs out, packets back. Verbose/mechanical work runs in the project agents in
`.claude/agents/` — this is standing authorization to spawn them per the tiers, without asking:

- **Tier 0 — inline:** single-file/trivial changes, quick questions. No agents.
- **Tier 1 — standard:** scout explores; reviewer + verifier gate every pre-PR; scribe drafts docs.
- **Tier 2 — wave:** planner partitions disjoint tracks → builders in parallel worktrees →
  sub-branch PRs into the feature branch.

Full playbook (roster, briefs/packets, wave mechanics, F5 packet): the `delegate` skill.
Agents read `.claude/wiki/index.md` before exploring; the wiki is curated at PR time.
Never delegated: scope agreement, F5, PR merges, `package.json` changes, version bumps.


## Conventions

Full list: [coding_standards.md](coding_standards.md). The load-bearing ones:

- snake_case for functions/variables, PascalCase for classes/types, `_` prefix for private members
- Domain objects are immutable — mutations return new instances; only `Runtime` is mutable
- Strict typing, no `any`
- **No new dependencies and no `package.json` changes without explicit user approval**
- Tests are plain functions that throw on failure, registered in `src/test/run_tests.ts` — follow the existing pattern


## Documentation rules

- Keep docs short, human-readable, and diagram-first — a good mermaid block diagram beats pages of text
- When a change alters architecture, the state machine, or data formats: update the relevant diagram in [docs/processes.md](docs/processes.md)
- Every PR adds one line to `CHANGELOG.md` under "Unreleased"
- **User stories** live in [docs/user-stories/](docs/user-stories/) (index: [docs/user-stories.md](docs/user-stories.md); one prose story per file from `TEMPLATE.md`). A story is prose — context, trigger, the expected sequence, and what must *not* happen — never a one-liner. **Capture trigger:** when the user states a user story or a user-experience expectation in chat ("as the user I…", "when I do X I expect…", "it should never…"), stop and offer to write/update it in `docs/user-stories/` before or alongside implementing — the story is the requirement, the issue is the delivery vehicle.
- Every feature branch keeps a short decision log in [docs/dev-log/](docs/dev-log/) (`issue-<N>-<slug>.md`, from `TEMPLATE.md`): started at plan time, finalized as a retrospective at PR time. It captures the *why* — decisions, trade-offs, rejected approaches — not a spec. This is the log the "no heavyweight spec files" rule leaves room for, not an exception to it.
- A development effort that spans multiple issues keeps an **arc log** in [docs/arc-log/](docs/arc-log/) (`arc-<slug>.md`, from `ARC-TEMPLATE.md`) — the *spine* above the per-issue dev-logs ("arc" both spans issues and is short for architecture). It holds the shared north-star architecture (diagram-first), the build order, and a live status table linking each issue → its dev-log → PR. Each issue's dev-log links back up to its arc. Rare and long-lived; the durable, checked-in home for a major arc (a GitHub epic/architecture issue is the discussion surface, the arc log is the record).
