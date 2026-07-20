# TimeScope Wiki Index

> *What this is: the map of the agent knowledge base — read this first, then only the pages your role needs.*

Agent-facing operational knowledge, curated with a ~200-line budget per page (prune before
appending). Provenance = these files' git history. Human docs live in `docs/`; this wiki is
the distilled "what a fresh agent needs so it doesn't re-derive the codebase."


## Pages

| Page | Contents |
| :--- | :--- |
| [arch.md](arch.md) | Module map (`src/core/`, `src/dashboard/`, entry point), domain objects, Runtime, the status-bar→disk→dashboard data flow |
| [contracts.md](contracts.md) | Webview↔extension message protocol, JSONL record format + record IDs, `.timescope/config.json` / `registry.json` / `jobs.json` schemas, package.json contributions |
| [ops.md](ops.md) | npm scripts, F5 dev rig + fixture workspaces incl. multi-instance two-host rig, seeding, CI, tooling versions, branch model, versioning discipline |
| [testing.md](testing.md) | Pure-Node suite pattern (throwing functions, `run_tests.ts`), Playwright webview harness, fixtures, how to add a test, coverage gaps |
| [gotchas.md](gotchas.md) | Invariants and traps: dedup layers, divergent session reconstruction, Windows atomic-write fallback, padding conventions, corrections log |


## Agent team

| Agent | File | Model / effort | Role |
| :--- | :--- | :--- | :--- |
| scout | [../agents/scout.md](../agents/scout.md) | sonnet / med | Recon + root-cause; read-only |
| architect | [../agents/architect.md](../agents/architect.md) | opus / high | Design studies for main-thread decisions |
| planner | [../agents/planner.md](../agents/planner.md) | opus / high | Slices, tracks, merge order |
| builder | [../agents/builder.md](../agents/builder.md) | sonnet / med | Core/domain/storage implementation |
| ui-builder | [../agents/ui-builder.md](../agents/ui-builder.md) | sonnet / med | Dashboard webview + Playwright |
| reviewer | [../agents/reviewer.md](../agents/reviewer.md) | opus / med | Adversarial diff review + invariants |
| verifier | [../agents/verifier.md](../agents/verifier.md) | sonnet / low | Pre-PR gate, F5 packet + readiness |
| scribe | [../agents/scribe.md](../agents/scribe.md) | sonnet / low | Docs drafts, wiki curation + lint |

Orchestration playbook (tiers, waves, briefs/packets): [../skills/delegate/SKILL.md](../skills/delegate/SKILL.md)
