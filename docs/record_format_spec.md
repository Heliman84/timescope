# TimeScope Record Format Specification


## Jobs Format

**File:** `jobs.json`

A simple JSON array of job name strings, sorted alphabetically and deduplicated.

```json
[
  "Lantern - Speaker",
  "TimeScope - Bug Fix",
  "TimeScope - Documentation"
]
```

**Schema:** `string[]`

---


## Event Format

**File:** `logs.jsonl` (JSON Lines)

Each line is either a header or an event record. All records are valid JSON objects.

### Header Line (Required)
Must appear as the first line of the file:

```json
{ "_format_version": 1 }
```

**Purpose:** File versioning for future schema evolution.

### Event Records
One JSON object per line. All fields must be present except `task`.

Event record format:

```json
{"event":<ev_pad8>, "job":<job_pad30>, "timestamp":<ts>, "task":<task_opt>}
```

Where:
```json
{
  "event": "start" | "stop" | "pause" | "resume",
  "job": string,
  "timestamp": number,
  "task": string (optional)
}
```

Examples:
```json
{"event":"start"   , "job":"test-issue9"                   , "timestamp":1771119496661}
{"event":"pause"   , "job":"test-issue9"                   , "timestamp":1771119680000}
{"event":"resume"  , "job":"test-issue9"                   , "timestamp":1771119803000}
{"event":"stop"    , "job":"test-issue9"                   , "timestamp":1771120113000, "task":"generating format_spec.md"}
```

---

### Event Record Fields

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

---

#### Malformed Lines
Non-throwing parser: if a line cannot be parsed as valid JSON or does not match the event schema, it is skiped silently.

#### Event Validation
After parsing, timescope validates:
- `event` is one of: `"start"`, `"stop"`, `"pause"`, `"resume"`
- `job` is a non-empty string
- `timestamp` is a finite number
- `task` (if present) is a string

---

### Minimal Example
**jobs.json:**
```json
[
    "test-issue9",
    "OtherJob"
]
```

**logs.jsonl:**
```json
{ "_format_version": 1 }
{"event":"start"   , "job":"test-issue9"                   , "timestamp":1771119496661}
{"event":"pause"   , "job":"test-issue9"                   , "timestamp":1771119680000}
{"event":"resume"  , "job":"test-issue9"                   , "timestamp":1771119803000}
{"event":"stop"    , "job":"test-issue9"                   , "timestamp":1771120113000, "task":"generating format_spec.md"}
```

This represents a single 10-minute session for "test-issue9".

---

### Formatting Notes
Records are stored with **human-readable padding** for manual inspection:

- Event values are padded to 8 characters
- Job names are padded to 30 characters

The padding is cosmetic; the JSON remains fully valid.

---


## Related Documentation

- [Record ID Specification](./record_id_spec.md) — Deterministic record IDs
