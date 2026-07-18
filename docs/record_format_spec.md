# TimeScope Record Format Specification


## Storage layout (local-first, #48)

Under the local-first model, a repo's committed `.timescope/logs.jsonl` **owns** its events; every
off-project session is owned by the global `scratch.jsonl`. The global `index.jsonl` is a derived,
rebuildable union of all owned sources and is the dashboard's read surface. There is **one owner
per event** — `appendEvent` writes exactly one owned log, then replicates into the index (no
dual-write). The legacy global `logs.jsonl` was migrated into scratch (backed up first) and retired.

This section documents the metadata files introduced across #48: `config.json` / `registry.json`
(48a) and `index.jsonl` / `scratch.jsonl` (48b/48c).

### Repo config — `.timescope/config.json`

A repo's authority about itself, committed with the repository. In 48a it carries only a stable
repo id (Client/Project binding + pinned task-types arrive with #15):

```json
{
  "repo_id": "a1b2c3d4e5f6",
  "format_version": 1
}
```

- `repo_id` — 12-char hex, generated once at opt-in and never regenerated (clone → same id).
- `.timescope/` is created **only** when the user opts in (first Start → "Track here?"), or when a
  `.timescope` folder already exists (existing folder ⇒ assume opted-in). This closes #2.

### Global registry — `registry.json`

A rebuildable cache of known repos (lives in the global storage dir alongside `logs.jsonl`). Used
to rebuild the global index efficiently and to dedup repos by id:

```json
{
  "format_version": 1,
  "repos": [
    { "id": "a1b2c3d4e5f6", "name": "lantern-fw", "path": "/work/lantern-fw", "last_seen": 1721000000000 }
  ]
}
```

- Entities (clients / projects / task-types) join the registry in #15; 48a tracks repos only.
- A malformed `registry.json` is a hard error (losing repo paths would defeat a rebuild); a
  missing file is treated as an empty registry.

### Derived global index — `index.jsonl`

A rebuildable cache in the global storage dir. It is the de-duplicated union (by event `id`) of
every registered repo's owned `.timescope/logs.jsonl` plus the global `scratch.jsonl`, in the same
event JSONL format as a log (header line + one event per line), sorted ascending by `timestamp`.

- **Derived and disposable** — never a source of truth. Deleting it loses nothing; `TimeScope:
  Rebuild Global Index` reconstructs it from the owned sources (repos in `registry.json` + scratch).
- Populated incrementally: `appendEvent` replicates each new event here, and it is rebuilt from the
  owned sources on activation and after edits/renames. The dashboard reads it (48c).

### Scratch log — `scratch.jsonl`

An **owned** event log in the global storage dir, in the same JSONL format as a log. It holds
sessions that don't belong to any repo — non-workspace (off-project) work — plus the migrated
legacy history. It is the successor to the retired global `logs.jsonl`.

- Written by `appendEvent` only when the current session has no opted-in workspace log.
- Feeds the index rebuild alongside repo logs. On the first activation after the cutover, the
  existing global `logs.jsonl` (historical, repo-less hours) is backed up to `logs.jsonl.migrated.bak`
  and its events are moved into scratch (deduped by id); the legacy file is then removed so the
  migration runs exactly once.


## Jobs Format

**File:** `jobs.json`

`jobs.json` is an array of job records (objects). Each entry is an immutable identifier plus lightweight metadata used by the UI and for stable ID generation.

Example entry:

```json
{
  "job_id": "k3f9g",
  "job_title": "Lantern - Speaker",
  "is_archived": false,
  "created": 1771119496661,
  "last_modified": 1771200000000,
  "job_seed": "Lantern - Speaker"
}
```

File-level shape (TypeScript):

```ts
interface JobDTO {
  job_id: string;        // stable, immutable id (short base36 or UUID)
  job_title: string;     // human-friendly title (mutable)
  is_archived?: boolean; // optional; default false
  created: number;       // Unix time in milliseconds since epoch (creation time)
  last_modified?: number;// Unix ms; last time title/metadata changed
  job_seed: string;     // the original `job_title` used to create `job_id`
}
```

Notes:
- Unique identity is `job_id`.
- `job_title` is editable; renames should update titles but not `job_id`.
- Sorting in UI may use `job_title`, but persisted files should remain stable and deduplicated by `job_id`.

---


## Event Format

**File:** `logs.jsonl` (JSON Lines)

Each line is either a header or an event record. All records are valid JSON objects.

### Header Line (Required)
Must appear as the first line of the file:

```json
{ "_format_version": 2 }
```

**Purpose:** File versioning for future schema evolution.

### Event Records
One JSON object per line. All fields must be present except `task`.

Event record format:

```json
{"id":<record_id_pad13>, "event":<ev_pad8>, "job":<job_pad30>, "timestamp":<ts>, "task":<task_opt>,  "job_id":<job_id>, "time_seed":<ts_original>}
```

Where:
```json
{
  "id": string,
  "event": "start" | "stop" | "pause" | "resume",
  "job": string,  "timestamp": number,  "task": string (optional),
  "job_id": string,
  "time_seed": number
}
```

Examples:
```json
{"id":  "ah8js-k-4fr",  "event":"start"   , "job":"test-issue9"                   , "timestamp":1771119496661,             "job_id":"16lor", "time_seed":1771119496661}
{  "id":"ah8ow-1-4fr",  "event":"pause"   , "job":"test-issue9"                   , "timestamp":1771119680000,             "job_id":"16lor", "time_seed":1771119680000}
{  "id":"ah8sb-2-4fr",  "event":"resume"  , "job":"test-issue9"                   , "timestamp":1771119803000,             "job_id":"16lor", "time_seed":1771119803000}
{"id":  "ah90x-3-4fr",  "event":"stop"    , "job":"test-issue9"                   , "timestamp":1771120113000, "task":"generating format_spec.md", "job_id":"16lor", "time_seed":1771120113000}
```

---

### Event Record Fields

#### `id` (string, required)
Deterministic event record ID in the format `<time5>-<bucket1>-<jobHash3>`.

See [Record ID Specification](./record_id_spec.md) for the full derivation rules.

#### `event` (string, required)
The type of event. Must be one of:

- `"start"` — Begin a time-tracking session
- `"pause"` — Temporarily pause the clock
- `"resume"` — Resume from a pause
- `"stop"` — End the session (optional task description may follow)

#### `job` (string, required)
The name of the job being tracked. Must:
- Be non-empty
- Match a name in `jobs.json`
- Remain the same for all events in a session

Example: `"TimeScope - Bug Fix"`

#### `timestamp` (number, required)
Unix time in milliseconds since epoch. Must be:
- A finite number
- Strictly increasing across events in the same session
- Non-negative

Example: `1739582342000` (represents Feb 15, 2025 at 07:52:22 UTC)

#### `task` (string, optional)
A free-text description of what was completed. Typically included with `stop` events.

Examples:
- `"Fixed issue #9"`
- `"Updated documentation"`
- `"Code review and merge"`

If omitted, the field is not present in the JSON (not `null`).

#### `job_id` (string, required)
Stable, immutable job identifier from `jobs.json`. This is the canonical link between events and jobs, and is used to derive `id`.

#### `time_seed` (number, required)
Original Unix time in milliseconds used to generate `id`. This value is immutable, even if `timestamp` is edited later.

---

#### Malformed Lines
Non-throwing parser: if a line cannot be parsed as valid JSON or does not match the event schema, it is skipped silently.

#### Load-Time Sanitizer
Every log read passes through a sanitizer (`src/core/log_sanitizer.ts`) that heals damage **in memory only** — disk is never rewritten on load:
- A physical line containing multiple concatenated JSON objects (the signature of an append made while the file lacked its trailing newline) is split into its records, provided the split is clean (2+ objects, each valid JSON, no residue). No partial salvage.
- Damage is reported (concatenated lines, missing header, malformed lines, pause/resume counts); when repairable damage exists on disk the user is offered the `TimeScope: Compact Log` command once per session.

#### Append / Rewrite Discipline
- **Appends are newline-safe**: before appending, the file's last byte is checked; a missing trailing `\n` is injected first so records can never concatenate (`append_line_safe` in `src/utils/fs_utils.ts`).
- **All full-file rewrites are atomic**: content is written to a temp file in the same directory and landed with an atomic rename (`write_file_atomic`), so a crash mid-rewrite can never tear the log. This applies to session edits, job renames, and compaction.
- **Compaction** (`TimeScope: Compact Log`) rewrites a log clean at the current format version: splits concatenated records, restores canonical field order and the header, preserves unparseable lines verbatim, writes `logs.jsonl.bak` first, and is idempotent.

#### Event Validation
After parsing, timescope validates:
- `id` matches the record ID format
- `event` is one of: `"start"`, `"stop"`, `"pause"`, `"resume"`
- `job` is a non-empty string
- `job_id` is a non-empty string
- `timestamp` is a finite number
- `time_seed` is a finite number
- `task` (if present) is a string

---

### Minimal Example
**jobs.json:**
```json
[
  {
    "job_id": "16lor",
    "job_title": "test-issue9",
    "is_archived": false,
    "created": 1771119490000,
    "last_modified": 1771119490000,
    "job_seed": "test-issue9"
  }
]
```

**logs.jsonl:**
```json
{ "_format_version": 2 }
{"id":  "ah8js-k-4fr",  "event":"start"   , "job":"test-issue9"                   , "timestamp":1771119496661,             "job_id":"16lor", "time_seed":1771119496661}
{  "id":"ah8ow-1-4fr",  "event":"pause"   , "job":"test-issue9"                   , "timestamp":1771119680000,             "job_id":"16lor", "time_seed":1771119680000}
{  "id":"ah8sb-2-4fr",  "event":"resume"  , "job":"test-issue9"                   , "timestamp":1771119803000,             "job_id":"16lor", "time_seed":1771119803000}
{"id":  "ah90x-3-4fr",  "event":"stop"    , "job":"test-issue9"                   , "timestamp":1771120113000, "task":"generating format_spec.md", "job_id":"16lor", "time_seed":1771120113000}
```

This represents a single 10-minute session for "test-issue9".

---

### Formatting Notes
Records are stored with **human-readable padding** for manual inspection:

- Event values are padded to 8 characters
- Job names are padded to 30 characters
- `start`/`stop`: 2 spaces after `"id":` (before the value) — `{"id":  "..."`
- `pause`/`resume`: 2 spaces before `"id"` (after `{`) — `{  "id":"..."`
- This keeps the ID value and all subsequent columns aligned across all event types
- When `task` is absent, 12 spaces are inserted before `"job_id"` to visually align columns

The padding is cosmetic; the JSON remains fully valid.

---


## Related Documentation

| Document | Description |
| :--- | :--- |
| [Record ID Specification](record_id_spec.md) | Deterministic record ID derivation (FNV-1a, base-36) |
| [Architecture & Processes](processes.md) | Runtime processes, state machine, and data flow |
| [DEVELOPMENT.md](../DEVELOPMENT.md) | Build, test, feature & release workflow |
| [README.md](../README.md) | User-facing overview, commands, settings |
