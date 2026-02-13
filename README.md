# 📘 TimeScope — VS Code Time Tracking & Analytics

TimeScope is a lightweight, developer-friendly time-tracking extension for Visual Studio Code.  
It helps you track work sessions, analyze your productivity, and review your day with a clean, interactive dashboard.

Whether you're billing clients, tracking personal projects, or simply curious about where your time goes, TimeScope gives you clarity without getting in your way.

---


## 🚀 Features

Track time for any job with four intuitive commands:

- Start a job  
- Pause when you step away  
- Resume when you return  
- Stop to finalize the session  

TimeScope automatically builds accurate sessions from your event history.

---

### 📊 Interactive Summary Dashboard

Explore your work visually with:

- Pie chart of time per job  
- Stacked bar chart of time per day  
- Raw session table with timestamps and tasks  
- Date presets (Today, This Week, Last 7 Days, This Month, Last 3 Months)  
- Job filters with a convenient “All” checkbox  

The dashboard is fast, responsive, and built for real-world workflows.

---

### 🗂️ Global + Workspace Storage

TimeScope supports:

- Global tracking (across all projects)  
- Workspace tracking (per-project logs)  

You can optionally choose a custom folder for global storage.

---

### 🧹 Automatic Session Reconstruction

TimeScope intelligently rebuilds sessions from your event stream:

- start → stop  
- start → pause → resume → stop  
- Multiple pause/resume cycles  
- Deduplication of mirrored global/workspace events  
- Accurate duration calculation  

No matter how you work, TimeScope keeps your data clean.

---


## 🛠️ Commands

| Command | Description |
| :-------- | :------------- |
| TimeScope: Start | Start tracking a job |
| TimeScope: Pause | Pause the current session |
| TimeScope: Resume | Resume a paused session |
| TimeScope: Stop | Stop the current session |
| TimeScope: Show Summary Dashboard | Open the analytics dashboard |
| TimeScope: Rename Job | Rename an existing job |

---


## ⚙️ Settings

### Global Storage Directory

```text
timescope.global_storage_dir
```

Choose a folder where TimeScope stores:

- jobs.json  
- logs.jsonl  

If unset, TimeScope uses VS Code’s built-in global storage directory.

---


## 📁 Data Format

TimeScope stores data in a simple, future-proof format.

### jobs.json

Tracks known jobs and metadata.

### logs.jsonl

Each line is a canonical event:

```JSON
{ "event": "start", "job": "Project A", "task": "feature-x", "timestamp": 1704320000000 }
```

The dashboard reconstructs sessions from these events.

---


## 📊 Dashboard Overview

The dashboard includes:

### Pie Chart

Visual breakdown of time per job.

### Stacked Bar Chart

Daily totals with job-level stacking.

### Session Table

Raw session data including:

- Date  
- Job  
- Duration  
- Task  
- Start time  
- Stop time  

### Filters

- Date presets  
- Job checkboxes  
- “All” checkbox for quick toggling  

---


## 🛣️ Roadmap

### 1. Web-Based Reporting (Exportable HTML Dashboard)

Generate a standalone HTML report that mirrors the in-editor dashboard, including:

- Charts  
- Filters  
- Raw session table  
- Optional embedded notes  

Perfect for sharing with clients or archiving your work.

---

### 2. Daily Logbook Entries

Optionally open a “logbook entry” file when starting a timer:

- Take notes for the day  
- Track context, tasks, or thoughts  
- View notes later by clicking a session in the dashboard  
- Include notes in exported reports  

This turns TimeScope into a combined time tracker + work journal.

---

### 3. Enhanced Exporting

- JSON export  
- CSV export  
- HTML export with charts  
- Optional PDF export via browser print  

---

### 4. Additional Future Enhancements

- Job grouping  
- Weekly/monthly summaries  
- Auto-pause on idle  
- Minimal floating timer  
- Keyboard shortcuts  

---


## 📦 Installation

TimeScope will soon be available on the Visual Studio Code Marketplace.

Until then, you can install it manually:

1. Clone the repository  
2. Run `npm install`  
3. Run `npm run compile`  
4. Press F5 to launch the extension in a new VS Code window  

---


## ❤️ Contributing

Pull requests, feature ideas, and bug reports are welcome.  
TimeScope is built to grow with your workflow.

---


## 🧑‍💻 Developer docs

Developer instructions (build, tests, release flow, secrets) are in [`DEVELOPMENT.md`](DEVELOPMENT.md) — see that file for details on the release workflow and required repository secrets.

---


## 📄 License

MIT License.  
See [`LICENSE.md`](LICENSE.md) for details.
