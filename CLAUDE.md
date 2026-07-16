# TimeScope — Claude Project Guide

VS Code extension for tracking consulting hours: start/pause/resume/stop work sessions from the status bar, with a webview analytics dashboard. Domain-driven design with immutable objects (`Event`, `Job`, `Session`), repositories for file I/O, and one mutable coordinator (`Runtime`). Architecture diagrams: [docs/processes.md](docs/processes.md). Data formats: [docs/record_format_spec.md](docs/record_format_spec.md).

## Commands

- `npm run compile` — TypeScript → `out/`
- `npm test` — compile + run the pure-Node test suite (`src/test/run_tests.ts`; no VS Code host needed)
- `npm run package` — build the `.vsix` (prepublish + vsce)
- **F5** (user-only) — Extension Development Host opening `test-workspace/`, whose `.vscode/settings.json` pins TimeScope storage to `test-workspace/global-storage/` so dev testing never touches real tracking data

## Branch model

- `develop` — integration branch, default PR target
- `main` — releases only (reached via release PRs from develop)
- Feature branches: `feature/issue-<N>-<slug>` off develop
- Hotfixes: branch off `main`, PR to main, then merge main back into develop

## Workflow

Three chat-driven loops, each a skill in `.claude/skills/`:

| Loop | Skill | Trigger |
| :--- | :--- | :--- |
| Feature (issue → PR) | `feature` | discussing/working a GitHub issue |
| Install latest develop build | `install` | "install the latest build" |
| Release develop → main | `release` | "do a release" |

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
