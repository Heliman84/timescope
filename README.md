# TimeScope — VS Code Time Tracking & Analytics

TimeScope is a lightweight, developer-friendly time-tracking extension for Visual Studio Code.
It helps you track work sessions, analyze your productivity, and review your day with a clean, interactive dashboard.

Whether you're billing clients, tracking personal projects, or simply curious about where your time goes, TimeScope gives you clarity without getting in your way.

---


## Features

Track time for any job with intuitive status-bar buttons and commands:

- **Start** a job (creates the job on-the-fly if none exist)
- **Pause** when you step away
- **Resume** when you return
- **Stop** to finalize the session and optionally add a task note

TimeScope automatically builds accurate sessions from your event history and recovers gracefully if VS Code is shut down while a job is running.

### Interactive Summary Dashboard

Explore your work visually with:

- Pie chart of time per job
- Stacked bar chart of time per day
- Session table with timestamps, tasks, and inline editing
- Date presets (Today, This Week, Last 7 Days, This Month, Last 3 Months)
- Job filters with a convenient "All" checkbox

### Global + Workspace Storage

- **Global tracking** — a single canonical log and job list across all projects
- **Workspace mirror** — optional per-project copy under `.timescope/`
- Configurable global storage directory (`timescope.global_storage_dir`)

### Shutdown Recovery

If VS Code closes while a session is running or paused, TimeScope detects the orphaned session on next launch and offers recovery options:

- Stop or pause the session (timestamped at shutdown or at relaunch)
- Resume with or without inserting a break
- Stay paused (no change)

### Domain-Driven Architecture

The codebase follows object-oriented, domain-driven design:

- Immutable domain objects: `Event`, `Job`, `Session`
- Immutable collections: `EventCollection`, `JobCollection`
- Centralized repositories: `EventRepository` (JSONL I/O), `JobRepository` (JSON I/O)
- `Runtime` — single source of truth for the active session, cached events, and UI state

See [Architecture & Processes](docs/processes.md) for details.

---


## Commands

| Command | Description |
| :--- | :--- |
| `TimeScope: Start` | Start tracking a job |
| `TimeScope: Pause` | Pause the current session |
| `TimeScope: Resume` | Resume a paused session |
| `TimeScope: Stop` | Stop the current session (prompts for task note) |
| `TimeScope: Show Summary Dashboard` | Open the analytics dashboard |
| `TimeScope: Rename Job` | Rename an existing job across all logs |

---


## Settings

| Setting | Description |
| :--- | :--- |
| `timescope.global_storage_dir` | Folder where TimeScope stores `jobs.json` and `logs.jsonl`. Defaults to VS Code's built-in global storage. |

---


## Data Format

TimeScope uses a versioned, append-only format. Full specification: [Record Format Spec](docs/record_format_spec.md).

### jobs.json

An array of `JobDTO` records — each with a stable `job_id` (FNV-1a hash), mutable `job_title`, and timestamps. See [Record ID Spec](docs/record_id_spec.md) for ID derivation.

### logs.jsonl

A JSON-Lines file. The first line is a version header (`{ "_format_version": 2 }`). Each subsequent line is a padded, column-aligned event record:

```json
{"id":"ah8js-k-4fr", "event":"start", "job":"Project A", "timestamp":1771119496661, "job_id":"16lor", "time_seed":1771119496661}
```

---

## Dashboard Overview

The dashboard is a webview panel (`retainContextWhenHidden`) with:

- **Pie chart** — visual breakdown of time per job
- **Stacked bar chart** — daily totals with job-level stacking
- **Session table** — raw data with inline edit support (validates changes before saving)
- **Filters** — date presets and job checkboxes

Edits go through `validateReplacement` / `validateReplacements` and surface errors (same-job ordering violations) or warnings (cross-job session overlaps) before persisting.

---

## Documentation

| Document | Description |
| :--- | :--- |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Build, test, feature workflow, release workflow, and script reference |
| [docs/processes.md](docs/processes.md) | Runtime architecture, state machine, and process diagrams (Mermaid) |
| [docs/record_format_spec.md](docs/record_format_spec.md) | On-disk format for `jobs.json` and `logs.jsonl` |
| [docs/record_id_spec.md](docs/record_id_spec.md) | Deterministic record ID derivation (FNV-1a, base-36) |
| [coding_standards.md](coding_standards.md) | Project coding conventions |

---

## Roadmap

1. **Web-Based Reporting** — exportable standalone HTML dashboard with charts and filters
2. **Daily Logbook Entries** — optional notes per session, viewable from the dashboard
3. **Enhanced Exporting** — JSON, CSV, HTML, and optional PDF export
4. **Future Enhancements** — job grouping, weekly/monthly summaries, auto-pause on idle, floating timer, keyboard shortcuts

---

## Installation

TimeScope will soon be available on the Visual Studio Code Marketplace.

For development setup, see [DEVELOPMENT.md](DEVELOPMENT.md).
