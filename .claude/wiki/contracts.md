# contracts.md — Integration Contracts

> *What this is: the exact message, file, and schema contracts between the extension, webview, and on-disk stores.*


## Webview ↔ extension messages

Sent in `src/dashboard/webview/dashboard.js`, handled in `src/dashboard/controller/dashboard.ts:50`.

| Direction | Message | Notes |
| :--- | :--- | :--- |
| web → ext | `{type:"request_data"}` | once on load (`dashboard.js:9`); reply is `summary_data` |
| web → ext | `{type:"edit_log_entry", payload:{id, new_record}}` | single edit (`dashboard.ts:60`) |
| web → ext | `{type:"edit_log_entries", payload:{edits:[{id,new_record}]}}` | session-modal batch (`dashboard.js:1003` → `dashboard.ts:124`) |
| ext → web | `{type:"summary_data", payload:DTO[], build_info}` | handled `dashboard.js:36` |
| ext → web | `{type:"edit_result", payload:{summary:{globalReplaced, workspaceReplaced, errors[], warnings[]}, payload:DTO[]}}` | `dashboard.js:52`; **warnings** = cross-job overlap, informational, save proceeds; **errors** block save, modal stays open |

`new_record` from the webview must be a full `EventDTO` shape
(`id, event, job_title, timestamp, job_id, time_seed[, task]`) — built at `dashboard.js:973`.


## JSONL record format (`docs/record_format_spec.md`)

- Header line `{"_format_version": 2}` must be first (`FORMAT_VERSION` in `log_sanitizer.ts:5`).
- Canonical field order via `Event.toJSONL()` (`event.ts:158`):
  `id, event, job, timestamp, task?, job_id, time_seed` — with cosmetic column padding
  (event→8 chars, job→30 chars; pause/resume vs start/stop align differently, `event.ts:182`).
- Event types: `start | pause | resume | stop` (`EventType`, `event.ts:4`).
- `Event.fromJSONL` is non-throwing; malformed/header lines → `null`.
- **Record ID** (`docs/record_id_spec.md`): `<time5>-<bucket1>-<jobHash3>`
  (`event.ts:358/370/382`); job hash = FNV-1a 32-bit base36.


## On-disk stores

| File | Owner / role | Schema |
| :--- | :--- | :--- |
| `.timescope/logs.jsonl` | repo-owned events (opted-in workspaces) | JSONL above |
| `scratch.jsonl` (global) | owned: non-workspace sessions; legacy log migrates here once | JSONL above |
| `index.jsonl` (global) | **derived, rebuildable, disposable** union of repo logs + scratch, dedup by id (`global_index.ts:39`) | JSONL above |
| `.timescope/config.json` | repo-owned identity (`REPO_CONFIG_FORMAT_VERSION = 2`, `repo_config.ts:5`) | `{repo_id, format_version, jobs?:[{job_id, job_title}]}`; `repo_id` stable 12-hex, never regenerated; `jobs` = US-06 cache, rewritten only when derived set changes (`jobs_differ`, `repo_jobs.ts:32`) |
| `registry.json` (global) | machine-local: known repos + declines (`REGISTRY_FORMAT_VERSION = 1`, `registry.ts:3`) | `{format_version, repos:[{id,name,path,last_seen}], declined:string[]}`; malformed file **throws** (never drop repo paths); missing → empty |
| `jobs.json` (global) | job metadata (`job_dto.ts`) | `[{job_id, job_title, is_archived?, created, last_modified?, job_seed}]`; `job_id` must match `/^[0-9a-z]{5}$/` (`job_repository.ts:139`); legacy string-array rejected with pointer to `scripts/upgrade_jobs.ts` |


## package.json contributions

- **Settings:** only `timescope.global_storage_dir` (string; relative resolves against first
  workspace folder). `timescope.global_jobs_path`/`global_log_path` are written at runtime
  (`extension.ts:75-76`) as read-only display mirrors — **not declared** contributions.
- **Commands:** `timescope.start/pause/resume/stop/dashboard/renameJob/showBuildInfo/`
  `compactLog/rebuildGlobalIndex/showStorageStatus` (`package.json:29-80`). `addJob`/`deleteJob`
  are registered in code (`extension.ts:364/393`) but not palette-contributed.

Any change to these contracts requires updating the spec docs (`docs/record_format_spec.md`)
and usually `docs/processes.md` — and package.json changes need explicit user approval.
