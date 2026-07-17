# Issue #35 — Build info: show installed commit/build date across machines

> Decision log, not a spec. Backfilled retrospectively (this predates the dev-log process, added in #36).

**Issue:** [#35](https://github.com/Heliman84/timescope/issues/35)  ·  **PR:** [#37](https://github.com/Heliman84/timescope/pull/37)

## Problem

The Extensions view Version column showed the same `0.2.0` for every dev build, and there was no way to tell which commit/branch/date was actually installed on a given machine. The original issue framed this as "ship `out/buildinfo.json` in the .vsix"; discussion reframed the real core as **"we aren't seeing useful version information."**

## Decisions & trade-offs

- **The Extensions-view Version column can't move without a real manifest bump.** VS Code reads it straight from `package.json` and forbids semver suffixes like `0.2.0-dev.<sha>`. `buildinfo.json` is a *complementary* surface, not a fix to that column — so we also needed a version-bump policy, not just the file.
- **Bump per PR, not only at release.** Every feature/bugfix PR bumps `package.json` (patch/minor; major pinned at `0` until a deliberate promotion). This keeps `develop`'s version continuously meaningful so the Extensions view reflects progress. Decoupled from actually building a `.vsix` — the install/release skills package whatever version is current, so per-PR bumping adds no build churn.
- **Confirm every bump `from → to`.** The user must approve the exact version transition; never bump silently. Recorded in `coding_standards.md` and enforced via the feature/release skill checklists.
- **Surface build info where the user actually looks**, not just the command palette: status-bar tooltip + dashboard footer, with the "Show Build Info" command as a secondary surface.
- **`format_build_info_full` composed from `format_status_bar_suffix`** rather than duplicating the version/sha construction — one source of truth for the shared prefix (code-review finding).
- **Write `buildinfo.json` in `vscode:prepublish`, not just `package`.** Caught during F5: the footer showed a stale `0.2.0` because prepublish (which F5's prelaunch task runs) never regenerated the file. Moving `write-buildinfo` into prepublish means F5, `npm test`, and `npm run package` all read a current file.
- **Git failures in `write_buildinfo.js` degrade to `"unknown"`**, matching the reader's graceful-null philosophy — build metadata is best-effort display, never load-bearing.

## Rejected approaches

- **Keep bumping only at release.** Rejected: dev builds would stay same-version between releases, which is exactly the "no useful version info" gap the issue is about.
- **Separate `build_info` postMessage to the webview.** Considered during altitude review; kept it as a sibling field on the existing `summary_data` message since build info is static for the panel's lifetime and a separate message added ceremony without benefit.

## Retrospective

Shipped as designed plus the two mid-flight fixes above (prepublish timing, git hardening), both surfaced by F5 and code review rather than up front. Field named `build_date` (snake_case) to match the persisted-record convention. Also folded in process controls born from a mistake this session — a pre-commit hook blocking direct commits to `develop`/`main`, and a CLAUDE.md rule that an "Other" answer to a clarifying question isn't consent. Version landed at **0.3.0**.
