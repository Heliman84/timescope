# Issue #33 — paths.ts: resolve relative global_storage_dir against the workspace folder

> Decision log, not a spec. Started at plan time, finalized as a retrospective at PR time.
> Keep it short — capture the *why*, not a blow-by-blow. Skip any section that doesn't apply.

**Issue:** https://github.com/Heliman84/timescope/issues/33  ·  **PR:** <link>

## Problem

`resolve_paths` used the `timescope.global_storage_dir` setting verbatim, so isolating F5 test storage
required committing a machine-specific absolute path in `test-workspace/.vscode/settings.json`. That path
only exists on the original machine/clone location, silently defeating the isolation everywhere else.

## Decisions & trade-offs

- **Relative-path resolution only, no `${workspaceFolder}` expansion.** The issue mentions variable
  expansion in passing, but a general variable expander is a bigger, fuzzier feature. Relative-vs-absolute
  resolution solves the actual problem (portable test-workspace setting) with far less surface area.
- **Relative value + no workspace folder open → fall back to VS Code's default global storage.** A relative
  path is meaningless without a root; resolving against `process.cwd()` would be surprising and could land
  data in an arbitrary place. Treat it as "can't resolve → ignore the setting."
- **Extracted a vscode-free helper `src/core/resolve_storage_dir.ts`.** `paths.ts` imports `vscode`, which the
  pure-Node test suite can't load. Putting the pure logic in its own module lets it be unit-tested directly,
  mirroring how `build_info.ts` stays testable.

## Rejected approaches

- Full VS Code variable substitution (`${workspaceFolder}`, `${env:...}`) — out of scope; see above.

## Retrospective

Shipped as planned: a vscode-free `resolve_storage_dir(raw, workspace_root)` helper (absolute → normalized,
relative → joined onto the first workspace folder, empty/unresolvable → null), wired into `resolve_paths`
which falls back to VS Code's default global storage on null. `test-workspace/.vscode/settings.json` now
commits the portable `"global-storage"`. Four unit cases in `src/test/test_paths.ts` cover all modes.

Small deviation from the plan: on code review we renamed the surrounding `customDir`/`globalDir` locals (plus
the new `resolvedDir`) to snake_case per CLAUDE.md rather than leaving the new var matching the old camelCase.
Version bumped 0.3.0 → 0.3.1 (patch, bugfix).
