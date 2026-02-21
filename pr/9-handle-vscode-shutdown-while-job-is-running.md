---
feature: Issue 9 - Handle-vscode-shutdown-while-job-is-running
files_to_modify:
  - src/core/timer.ts
  - src/dashboard/controller/dashboard.ts
  - src/dashboard/webview/dashboard.js
  - src/dashboard/webview/index.html
  - src/extension.ts
  - src/test/run_tests.ts
  - src/test/test_jobs.ts
  - src/utils/fs_utils.ts
  - test-workspace/.timescope/logs.jsonl
  - test-workspace/logs.jsonl
  - tsconfig.json
tests_to_update:
  - src/test/test_dashboard.ts
  - src/test/test_event.ts
  - src/test/test_event_collection.ts
  - src/test/test_event_collection_extended.ts
  - src/test/test_event_repository.ts
  - src/test/test_job.ts
  - src/test/test_job_collection.ts
  - src/test/test_session.ts
  - src/test/test_jobs.ts
  - src/test/run_tests.ts
new_files:
  - docs/processes.md
  - docs/record_format_spec.md
  - docs/record_id_spec.md
  - pr/9-handle-vscode-shutdown-while-job-is-running.md
  - scripts/repair_orphaned_sessions.ts
  - scripts/upgrade_jobs.ts
  - scripts/upgrade_log_to_v2.ts
  - scripts/validate_jobs.ts
  - scripts/validate_upgraded.ts
  - src/core/event.ts
  - src/core/event_collection.ts
  - src/core/event_dto.ts
  - src/core/event_repository.ts
  - src/core/job.ts
  - src/core/job_collection.ts
  - src/core/job_dto.ts
  - src/core/job_repository.ts
  - src/core/recovery.ts
  - src/core/runtime.ts
  - src/core/session.ts
  - src/dashboard/controller/dashboard_utils.ts
  - src/test/test_dashboard.ts
  - src/test/test_event.ts
  - src/test/test_event_collection.ts
  - src/test/test_event_collection_extended.ts
  - src/test/test_event_repository.ts
  - src/test/test_job.ts
  - src/test/test_job_collection.ts
  - src/test/test_session.ts
  - src/ui/pick_job.ts
  - test-workspace/.timescope/orphan_repair_report_20260220_162208.md
  - test-workspace/test_jobs.json
deleted_files:
  - src/core/jobs.ts
  - src/core/logs.ts
  - src/core/state.ts
  - src/core/types.ts
  - src/test/test_logs.ts
  - src/test/test_update_log.ts
  - src/test/test_update_session.ts
---

# PR: Issue 9 - Handle-vscode-shutdown-while-job-is-running

Issue: [#9](https://github.com/Heliman84/timescope/issues/9)


## Summary

### Github Issue Description
Currently, if VSCode is shut down while a job is running, the job is not terminated leaving a `start` event without a corresponding `stop`. When VSCode is restarted there is only the option to `start` again. This leads to data corruption or incomplete processing.

### What the feature is
* Detect when VS Code was previously closed while a job was still running.
* If the last event was `start` or `resume`, ask whether to add a `stop` or `pause` event and whether it should be timestamped at shutdown or at next launch.
* If the last event was `pause` then ask the use how to resolve.
* Move into the appropriate state based on the chosen event (stop or pause).
* Restore TimeScope to a consistent state so the user can continue tracking time without manual cleanup.
* Ensure the UI reflects the correct state (e.g., prevents showing “Start” when a job is technically still open).
* Provide a deterministic, corruption‑free recovery path for incomplete sessions.
* Provide a script to validate and clean up the local and global log files
* If the previous closing state was paused, resume tracking on launch and show a banner indicating the job and that it is paused.
* Convert procedural code to object-oriented design to improve maintainability and robustness of the recovery implementation.This includes:
  * Domain objects: `Session` (represents a single start→(pause/resume)*→stop timeline), `Event` (represents a single start, pause, resume, or stop event, carying metadata to align it with the workspace and global logs), `Job` (represents a single job), and `Runtime` (centralized state container for active session, repositories, and UI).
  * Domain object collections: `EventCollection` (immutable collection of events with validation and transformation methods) and `JobCollection` (manages multiple jobs and their sessions).
  * Centralized repositories: `EventRepository` (handles all JSONL I/O, append deduplication, and tail queries for events) and `JobRepository` (manages job-level operations and migrations).
  * Refactored activation and command handlers to utilize the new domain model and repositories, eliminating redundant disk reads and ensuring the in-memory session is the single source of truth during active use.

### Why the feature exists
* A running job that never receives a stop event leaves the log in an invalid or ambiguous state.
* Users currently have no way to “resume” or “fix” an abandoned job after a crash or shutdown, forcing them to either lose data or manually edit logs.
* Orphaned start events break downstream processing (summaries, dashboards, duration calculations).
* Automatically repairing the state on startup makes the system resilient to crashes, restarts, and OS‑level interruptions.

### Additional changes
* Updated the workflow to utilize the GitHub PR extension for better branch management and traceability.


## User-Facing Behavior

* Command pallet updates
  * No user-facing command is exposed in the Command Palette to resolve orphaned sessions - scripts must be manually run from the terminal.
    * The recovery flow requires no manual log edits or additional configuration.
    * The scrub operation scans and validates the entire log history (not just the latest event).
  * If the last event was `start` or `resume`, the command prompts for `stop` vs `pause` and the timestamp choice.
  * No other recovery or validation commands are exposed to users; internal steps run under the hood.
  * The UI reflects the corrected state after recovery so tracking can resume normally.
* UI Updates
  * Recovery banner on startup when resuming from a paused state, including the job name.
* Dashboard updates
  * Enhanced feedback to user in event edit if validation of changes fail
  * Increase timestamp precision to the second


## Test Requirements (filled in by Copilot Agent)

* Unit test: orphaned start in global log prompts for stop vs pause on startup.
* Unit test: orphaned start in workspace log prompts for stop vs pause on startup.
* Unit test: recovery is idempotent (no duplicate stop on second run).
* Unit test: valid start/stop sequence remains unchanged.
* Unit test: paused/resumed sequences are not corrupted by recovery.
* Unit test: paused session resumes on launch with correct job name.


## Non-Goals / Out of Scope (filled in by Copilot Agent)

* Exposing a user-facing command to trigger recovery (recovery runs automatically on startup if needed).


## Acceptance Criteria (filled in by Copilot Agent)

* On startup, if the last event was start or resume, the user is prompted to choose stop vs pause and timestamp.
* On startup, a paused session resumes and displays a banner with the job name.
* Recovery does not change valid sessions.
* The UI reflects the corrected state after recovery.
* If job.json or logs.jsonl are corrupted or contain invalid records, the user is informed with clear error messages and guided to run the validation/repair script.
* All required tests pass and the extension activates normally.


## Implementation Plan

1. Update feature development process to sync with GitHub PR extension workflow.
2. Refactor codebase to implement object-oriented design with domain objects (`Session`, `Event`, `Job`, `Runtime`) and repositories (`EventRepository`, `JobRepository`).
3. Implement recovery logic in `src/core/recovery.ts` to detect orphaned sessions on startup and prompt the user for resolution.
   1. Update `src/extension.ts` to invoke recovery logic during activation.
4. Implement new log format according to the v2 format spec, including a file header with `_format_version` and structured event records. [See spec](../docs/record_format_spec.md).
   1. Update record validation to enforce the new format and reject invalid records with structured error messages.
5. Implement log migration script (`scripts/upgrade_log_to_v2.ts`) to convert existing logs to the new format, including validation and backup creation.
6. Implement `jobs.json` migration script (`scripts/upgrade_jobs.ts`) to convert existing job files to the new format and structure, including validation and backup creation.
7. Implement log validation and repair script (`scripts/validate_and_repair_logs.ts`) to scan logs for common issues (orphaned starts, missing stops, invalid records) and either automatically repair or generate a report with instructions for manual fixes.
8. Update the dashboard controller and webview to handle the new event structure and provide user feedback on validation errors during event edits.
9. Update and expand the test suite to cover the new recovery logic, log format, and validation rules, ensuring all tests pass and the extension activates without errors.


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

### Domain-oriented refactor: Session, LogRepository, and in-memory state authority

Recent work completed a major architectural refactor to restore domain-driven design principles and eliminate disk reloads during active use:

Initial testing of the session recovery failed completely. This was because there were still many pieces that were fragile/programmed in place, not following proper OOP principles. So this section of effort was focused on cleaning up the architecture to make the recovery implementation more straightforward and robust. The main changes were:

* **Session as single-run state machine:** Added `Session` as domain object representing a single start→(pause/resume)*→stop timeline. `Session` now owns all run-level validation, state transitions, and elapsed time calculations.
* **LogRepository as centralized persistence:** Created `LogRepository` to own all file I/O (JSONL parsing, append dedup, workspace/global mirroring). Implemented backward-scanning APIs (`loadLastSession`, `loadLastNSessions`) for efficient O(n) tail queries without reconstructing entire session history.
* **In-memory activeSession as authoritative state:** Refactored extension command handlers (start, pause, resume, stop) to read from `runtimeState.activeSession` instead of calling `repo.loadLastSession()` after each event. Commands now mutate the in-memory session, persist to disk via `repo.appendValidated()`, and refresh UI—no redundant disk reads during active use.
* **Centralized runtime state:** Unified all extension-wide mutable state (active session, session provider, timer interval) in `runtimeState` container to provide clear visibility of what persists across the extension lifecycle.
* **EventCollection remains pure:** Stripped session logic from `EventCollection`; it is now a pure immutable data container for parsing, serializing, filtering, and basic operations—no state machine behavior.

This refactor improves testability, reduces coupling, eliminates wasteful disk I/O during active operation, and ensures the in-memory session is the single source of truth while the extension runs. It has also massively improved the robustness of the codebase making all parts more concise, readable, and maintainable. The recovery implementation was then built on top of this cleaner architecture, allowing for a more straightforward and reliable implementation.

### Changes in this commit

* Added `Runtime` class as the single source of truth owning UI, active session, timer interval, and repositories.
* Removed procedural `jobs.ts`
* Introduced a job factory (`Job.create`) and migrated the activation/commands to use domain `Job` and `JobCollection`.
* Introduced new Job record structure accoring to [Record Format Spec](../docs/record_format_spec.md) and migrated all job file interactions to use this format.
* Removed legacy global state and module-level UI/timer globals; UI ownership now lives in `Runtime`.
* Refactored `timer.ts` into pure helper functions that accept a `Runtime` instance and hold no module state.
* `JobRepository` now detects legacy job-file format and advises running `scripts/upgrade_jobs.ts`.
* Added `scripts/upgrade_jobs.ts` — an idempotent, atomic developer tool to upgrade legacy job files.
* Completed the OOP migration across activation, commands, and repositories; tests and TypeScript checks were updated accordingly.
* This commit finalizes the object‑oriented refactor and prepares the codebase for safer feature development.

### Summary of changes `1d705ff`–`fecd9bd`

#### Architecture & domain model
* Replaced `LogRepository` and procedural `logs.ts`/`jobs.ts` with `EventRepository` (JSONL I/O, append-dedup, line-index tracking) and immutable `Event`/`EventCollection`/`Job`/`JobCollection` domain objects.
* `Event` is now fully immutable with deterministic record IDs (FNV-1a), DTO round-trip fidelity, padded JSONL serialization, and built-in transition validation.
* `EventCollection` owns filtering, sorting, immutable transforms (`replaceEvent`, `retimeEvent`, `mapEvents`, `rewrite`, `withUpdatedJob`), and pre-save validation (`validateReplacement`/`validateReplacements`) that blocks same-job ordering violations and warns on cross-job session overlaps.
* `Runtime` caches the loaded `EventCollection`, eliminating redundant disk reads during active use.
* Extracted `fs_utils.ts` for shared file-system helpers; extracted `dashboard_utils.ts` for vscode-free pure functions (`buildPayload`, `filterRelevantErrors`).

#### Dashboard edit flow
* Fixed silent-failure bug: webview now preserves `id`/`job_id`/`time_seed` on events and sends complete DTOs on save.
* Controller reconstructs events via `Event.fromDTO`, looks up by ID, and runs `validateReplacement` before writing—invalid retimes are rejected with user-facing error messages; cross-job overlaps surface as warnings (yellow banner, save still proceeds).
* `replaceEvent` filters header lines before rewriting to prevent header duplication.

#### Log format & migration tooling
* Introduced `_format_version: 2` file header and `upgrade_log_to_v2.ts` migration script.
* Added `repair_orphaned_sessions.ts` for interactive orphan detection and repair with markdown report output.
* Added `validate_jobs.ts` / `validate_upgraded.ts` developer validation scripts.

#### Test suite
* Grew from ~5 test files / ~22 functions to 11 test files / ~50+ functions covering: `Event`, `Job`, `JobCollection`, `EventCollection` (extended), `EventRepository`, `Session`, dashboard (`buildPayload`, `filterRelevantErrors`, `replaceEvent`, edit round-trips, invalid-retime rejection, batch edits), and cross-job overlap warnings.
