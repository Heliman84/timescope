---
feature: <FEATURE_NAME>
files_to_modify:
  - src/<file1>.ts
  - src/<file2>.ts
tests_to_update:
  - test/<file1>.test.ts
new_files: []
deleted_files: []
---

# PR: <FEATURE_NAME>

## Summary

* What the feature is.
* Why it exists.
* Written with Microsoft 365 Copilot.

## User-Facing Behavior

* What the user sees.
* What the user can do.
* Business or UX constraints.
* Commands, settings, or UI changes.
* Dashboard or status bar impact.
* Any new interactions or flows.

## Technical Requirements (filled in by Copilot Agent)

* Architecture constraints.
* Data model or log format changes.
* Files to modify.
* Files to avoid.
* Performance or reliability considerations.

## State Machine Impact (filled in by Copilot Agent)

* New states, transitions, or events.
* States that must remain unchanged.
* Error or edge-state handling.

## Dashboard / Webview Impact (filled in by Copilot Agent)

* UI elements added, removed, or changed.
* Data displayed or refreshed.
* Interaction behavior or lifecycle notes.

## Test Requirements (filled in by Copilot Agent)

* Required unit tests.
* Expected scenarios or coverage.
* Test files to create or update.
* Tests that must NOT be modified.

## Non-Goals / Out of Scope (filled in by Copilot Agent)

* Behaviors or flows that must not change.
* Files or systems explicitly excluded.
* Deferred or future work.

## Acceptance Criteria (filled in by Copilot Agent)

* Extension activates correctly.
* Dashboard loads without errors.
* No changes to package.json unless approved.
* No new dependencies.
* All modified files compile cleanly.
* All required tests pass.

## Implementation Plan (filled in by Copilot Agent)

* Leave this empty.
* Copilot Agent generates the plan after reading the spec.
