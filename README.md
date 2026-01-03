# TimeScope for VS Code

A clean, manual time‑tracking extension for VS Code with:

- Job selection (global + workspace jobs)
- Pause / resume
- Optional task descriptions
- JSONL logging with unlimited history
- A Summary Dashboard entry point for future charts and analytics

---

## Features

- **Manual control:**
  - Start – begin tracking time for a selected job
  - Pause – temporarily stop accumulating time
  - Resume – continue from where you paused
  - Stop – finalize the session with an optional task description

- **Jobs with persistence:**
  - Choose from global jobs (shared across all workspaces)
  - Choose from workspace jobs (specific to one project)
  - Add new jobs with a simple “global vs workspace” choice
  - Jobs are stored in JSON files you can edit manually

- **JSONL logging:**
  - Every event is written as a single JSON object per line
  - Ideal for later parsing, analysis, and plotting

- **Status bar UI:**
  - Dedicated buttons for Start, Pause, Resume, Stop
  - Live duration timer (Working / Paused)
  - A Summary button for the upcoming dashboard

- **Summary dashboard hook:**
  - Command and button are already in place
  - Will later open a rich Webview summary with charts and filters

---

## Status bar workflow

The extension uses status bar items as “buttons”. Depending on the state, you will see:

### Idle

[ Start ]     [ Summary ]

### Running

[ Pause ]   Working: Xh Ym   [ Stop ]     [ Summary ]

### Paused

[ Resume ]   Paused: Xh Ym   [ Stop ]     [ Summary ]

You can also access all commands via the Command Palette:

- TimeScope: Start
- TimeScope: Pause
- TimeScope: Resume
- TimeScope: Stop
- TimeScope: Show Summary Dashboard

---

## Jobs: global and workspace

When you start tracking, you select a job.

### Selecting a job

On Start, you’ll see a Quick Pick with something like:

Workspace jobs  
• Router Upgrade  
• Fusion 360 Add‑in  

Global jobs  
• ACME  
• Internal R&D  

──────────────  
➕ Add New Job…

### Adding a new job

If you choose “➕ Add New Job…”:

1. You’ll be asked for a job name.
2. Then you’ll choose where to save it:
   - Save as global job (default)
   - Save as workspace job

### Where jobs are stored

Global jobs:
```
%APPDATA%/timescope/jobs.json
```

Workspace jobs:
```
<workspace>/.timescope/jobs.json
```

Each file looks like:
```json
{
  "jobs": ["ACME", "Internal R&D", "Router Upgrade"]
}
```

---

## Time tracking behavior and states

### Start
- Prompts you to select or add a job.
- Begins a new session for that job.
- Logs a `start` event.

### Pause
- Freezes time accumulation.
- Stores elapsed time up to the pause moment.
- Logs a `pause` event.

### Resume
- Continues from the paused elapsed time.
- Logs a `resume` event.

### Stop (running)
- Stop time = current time.
- Prompts for optional task description.
- Logs a `stop` event with duration.

### Stop (paused)
- Stop time = pause time (no extra time added).
- Prompts for optional task description.
- Logs a `stop` event with duration.

---

## Logging format and location

### Log file location

Workspace:
```
<workspace>/logs/work_log.jsonl
```

Global fallback:
```
%APPDATA%/timescope/logs/work_log.jsonl
```

### JSONL format

Start:
```json
{"type":"start","timestamp":"...","job":"ACME"}
```

Pause:
```json
{"type":"pause","timestamp":"...","job":"ACME"}
```

Resume:
```json
{"type":"resume","timestamp":"...","job":"ACME"}
```

Stop (running):
```json
{
  "type": "stop",
  "timestamp": "...",
  "job": "ACME",
  "task": "fixed login bug",
  "duration_ms": 6300000
}
```

Stop (paused):
```json
{
  "type": "stop",
  "timestamp": "...",
  "job": "ACME",
  "task": "meeting break",
  "duration_ms": 2400000
}
```

---

## How to build and run

Install dependencies:
```
npm install
```

Compile:
```
npm run compile
```

Launch:
- Press F5 in VS Code to open the Extension Development Host.
- Open a workspace folder.
- Use the status bar buttons or the Command Palette.

---

## Planned features (roadmap)

### Summary dashboard Webview
Will include:
- Time per job
- Time per day
- Time per job per day
- Weekly and monthly totals
- Interactive charts
- Filters for job and date range

### Export and reporting
- CSV export
- JSON export
- Weekly/monthly summaries

### Idle detection
- Auto‑pause after inactivity
- Resume prompts

### Multi‑job analytics
- Compare jobs
- Job mix over time
- Focus area analysis

---

## Notes

- All storage is plain text (JSONL and JSON files).
- You remain in full control of your data.
- The current version focuses on clean, predictable tracking; analytics come next.

