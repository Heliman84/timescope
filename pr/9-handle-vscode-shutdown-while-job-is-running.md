---
feature: Issue 9 - Handle-vscode-shutdown-while-job-is-running
files_to_modify:
  - src/extension.ts
  - src/core/logs.ts
  - src/core/state.ts
  - src/core/timer.ts
  - src/core/types.ts
  - src/dashboard/controller/dashboard.ts
  - src/dashboard/webview/dashboard.js
  - src/dashboard/webview/index.html
tests_to_update:
  - src/test/test_logs.ts
  - src/test/test_update_log.ts
  - src/test/test_update_session.ts
new_files:
  - src/test/test_recovery.ts
deleted_files: []
---

# PR: Issue 9 - Handle-vscode-shutdown-while-job-is-running

Issue: [#9](https://github.com/Heliman84/timescope/issues/9)


## Summary

### Github Issue Description
Currently, if VSCode is shut down while a job is running, the job is not terminated leaving a `start` event without a corresponding `stop`. When VSCode is restarted there is only the option to `start` again. This leads to data corruption or incomplete processing.

### What the feature is
* When VS Code closes detect if a job is still running and fire a stop event to close it out.
* Detect when VS Code was previously closed while a job was still running.
* If the last event was `start` or `resume`, ask whether to add a `stop` or `pause` event and whether it should be timestamped at shutdown or at next launch.
* Move into the appropriate state based on the chosen event (stop or pause).
* Restore TimeScope to a consistent state so the user can continue tracking time without manual cleanup.
* Ensure the UI reflects the correct state (e.g., prevents showing “Start” when a job is technically still open).
* Provide a deterministic, corruption‑free recovery path for incomplete sessions.
* Provide a script to validate and clean up the local and global log files
* If the previous closing state was paused, resume tracking on launch and show a banner indicating the job and that it is paused.

### Why the feature exists
* A running job that never receives a stop event leaves the log in an invalid or ambiguous state.
* Users currently have no way to “resume” or “fix” an abandoned job after a crash or shutdown, forcing them to either lose data or manually edit logs.
* Orphaned start events break downstream processing (summaries, dashboards, duration calculations).
* Automatically repairing the state on startup makes the system resilient to crashes, restarts, and OS‑level interruptions.

### Additional changes
* Updated the workflow to utilize the GitHub PR extension for better branch management and traceability.


## User-Facing Behavior

* Command pallet updates
  * A single user-facing command is exposed in the Command Palette to resolve orphaned sessions.
  * Running the command validates logs and auto-repairs any missing stop events from an interrupted session.
  * If the last event was `start` or `resume`, the command prompts for `stop` vs `pause` and the timestamp choice.
  * The command provides feedback on the number of sessions recovered and any issues found during validation.
  * No other recovery or validation commands are exposed to users; internal steps run under the hood.
  * The UI reflects the corrected state after recovery so tracking can resume normally.
  * The recovery flow requires no manual log edits or additional configuration.
  * The scrub operation scans and validates the entire log history (not just the latest event).
  * Each detected issue prompts an interactive resolution dialog until all issues are resolved or the user cancels.
* UI Updates
  * Dashboard action: “Scrub Logs” button that runs the validate step and shows a summary panel.
  * Recovery banner on startup when an orphaned session is auto-fixed, with a “View details” link.
  * Recovery banner on startup when resuming from a paused state, including the job name.
  * Small status bar hint when a recovery occurs (e.g., “Recovered 1 session”).
  * Dashboard section listing “Recovered Sessions” with timestamps and job names (read-only).


## Technical Requirements (filled in by Copilot Agent)

* Ensure recovery logic runs at startup before any new tracking starts.
* Detect orphaned start events in both global and workspace logs.
* If the last event is `start` or `resume`, prompt for `stop` vs `pause` and timestamp choice (shutdown vs next launch).
* Apply the selected event and timestamp consistently in global and workspace logs.
* Keep log format unchanged; only append stop events.
* Update state consistently across in-memory state and persisted logs.
* Preserve existing behavior for normal start/pause/resume/stop flows.
* Provide a user-facing recovery command that runs validation + repair.
* Keep recovery idempotent (multiple runs do not create duplicate stops).
* If the last event is `pause`, start in the `pause` state (showing the resume session) on launch and surface a banner with the job name.
* The recovery command validates the entire log history and prompts for each detected issue until resolved or canceled.


## State Machine Impact (filled in by Copilot Agent)

* Add a recovery step on activation to handle `start` or `resume` as the last event by prompting for `stop` vs `pause`.
* If the last event is `pause`, start in the `pause` state (showing the resume session) on launch and keep the session open.
* Ensure recovery does not alter valid stopped states.
* Handle edge cases where logs end with `pause` or `resume` without a following stop.
* Avoid creating multiple stop events for the same start.


## Dashboard / Webview Impact (filled in by Copilot Agent)

* Add a dashboard action for the recovery command ("Scrub Logs") and show summary results.
* Surface recovery results in the dashboard (read-only list of recovered sessions).
* Ensure the dashboard reloads after recovery to reflect corrected totals.


## Test Requirements (filled in by Copilot Agent)

* Unit test: orphaned start in global log prompts for stop vs pause on startup.
* Unit test: orphaned start in workspace log prompts for stop vs pause on startup.
* Unit test: recovery is idempotent (no duplicate stop on second run).
* Unit test: valid start/stop sequence remains unchanged.
* Unit test: paused/resumed sequences are not corrupted by recovery.
* Unit test: paused session resumes on launch with correct job name.


## Non-Goals / Out of Scope (filled in by Copilot Agent)

* No changes to the log format or event schema.
* No new settings or configuration for recovery behavior.
* No new dependencies.


## Acceptance Criteria (filled in by Copilot Agent)

* On startup, if the last event was start or resume, the user is prompted to choose stop vs pause and timestamp.
* On startup, a paused session resumes and displays a banner with the job name.
* Recovery does not change valid sessions.
* The UI reflects the corrected state after recovery.
* The recovery command validates and repairs logs without manual edits.
* All required tests pass and the extension activates normally.


## Implementation Plan (filled in by Copilot Agent)

1. Identify where startup/activation loads logs and current state.
2. Add recovery logic that detects last event as `start` or `resume` and prompts for stop vs pause.
3. Apply the selected event with shutdown vs launch timestamp as chosen.
4. If the last event is `pause`, resume the session and show a banner with the job name.
5. Apply recovery to both global and workspace logs.
6. Ensure recovery updates in-memory state before any new session starts.
7. Add a single user-facing command that runs validation + recovery and reports results.
8. Add dashboard UI action to trigger the command and show a summary.
9. Add tests for stop/pause prompt flow, paused resume, and idempotency.
10. Verify no changes to log format and no new dependencies.


## Execute notes

### Refactor updates - move to object oriented event and event collection model to handle records
Since the original design notes above, the following internal refactors have been completed to make recovery implementation safer and easier:

* **Centralized event parsing & validation:** Introduced `src/core/event.ts` exporting `parseLogLine()` and `EventCollection`. All parsing, validation, and event-sequence logic now lives in this module to provide a single source of truth for event semantics.
* **Canonical serialization:** `EventCollection.formatRecord()` serializes records with a stable property order and a `formatVersion: 1` field to enable future format migrations.
* **Replaced ad-hoc formatting/parsing:** The codebase was audited and remaining direct `JSON.parse` / manual JSON formatting of log records were replaced to use `parseLogLine()` and `EventCollection.formatRecord()` so formatting changes are contained in one place.
* **Append dedup check:** `append_log_record()` now compares the last persisted record with the candidate using `EventCollection.recordsEqual()` and skips append if identical, reducing duplicate records caused by retries or shutdown races.
* **Validation returns structured errors:** Validation now returns `ValidationError` objects (index, code, message, optional record) to make programmatic fixes and UI presentation reliable.
* **Tests updated / added:** Unit tests were added and extended to cover `EventCollection` validation rules, serializer round-trips, and rename/replace roundtrip scenarios. The test suite passes.

These changes are internal and backward-compatible: existing logs without `formatVersion` are still parsed by `parseLogLine()`, and the recovery plan above remains applicable.

### Implemented VS Code shutdown session recovery and log validation

Picking up after the refactor notes above, here are the concrete follow-on changes and the exact files touched in this staged work:

* Recovery implementation and UX
  * Added: `src/core/recovery.ts`
  * Activation: `src/extension.ts` now invokes `checkAndRecover()` to run recovery at startup.
  * Behavior: prompts cover stop/pause/resume choices, timestamp-at-shutdown vs now, and resume/no-break vs break semantics.

* Log _format_version and serialization
  * Updated: `src/core/event.ts` — added `EventCollection.formatRecord()` and strengthened `parseLogLine()` to ignore file headers.
  * Updated: `src/core/logs.ts` — introduced file-level header (`_format_version`), header-aware reads/writes, and dedup-on-append/idempotency checks.

* Controller and webview fixes
  * Updated: `src/dashboard/controller/dashboard.ts` — scope validation errors to edited occurrences so unrelated validation issues aren't shown as errors for a successful edit.
  * Updated: `src/dashboard/webview/dashboard.js` — session edit modal includes seconds in `datetime-local` and compares timestamps to the second to avoid accidental edits.

* Exact files modified/added in this staged change set:
  * Modified: `src/core/event.ts`, `src/core/logs.ts`, `src/dashboard/controller/dashboard.ts`, `src/dashboard/webview/dashboard.js`, `src/extension.ts`, `src/test/run_tests.ts`, `src/test/test_event_collection.ts`, `src/test/test_jobs.ts`, `src/test/test_logs.ts`, `src/test/test_rename_roundtrip.ts`, `src/test/test_update_log.ts`, `src/test/test_update_session.ts`.
  * Added: `src/core/recovery.ts`.
  * Workspace test fixture updated: `test-workspace/.timescope/logs.jsonl` (header + sample adjustments).

