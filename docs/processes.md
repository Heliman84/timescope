# TimeScope — Architecture & Processes

> Runtime processes, state machines, and data flow for the TimeScope VS Code extension.
> For build/release workflow see [DEVELOPMENT.md](../DEVELOPMENT.md).
> For user-facing overview see [README.md](../README.md).

---


## 1. Activation & Startup

```mermaid
flowchart TD
    A["activate(context)"] --> B["new Runtime(context)"]
    B --> B1["resolve_paths<br>→ global & workspace dirs"]
    B --> B2["JobRepository<br>EventRepository created"]
    B --> B3["load_build_info(extensionRoot)<br>→ out/buildinfo.json or null"]
    A --> C["runtime.loadJobs()"]
    C --> D["update VS Code settings<br>(global_jobs_path, global_log_path)"]
    D --> R["register_if_opted_in<br>→ registry.update(upsert)"]
    R --> L["acquire_lock(repo_id)<br>locks/&lt;repo_id&gt;.lock.json"]
    L --> L1{"live foreign lock?"}
    L1 -- Yes --> L2["warn: already tracked<br>elsewhere; suppress recovery"]
    L1 -- No --> E["runtime.initializeUI()<br>→ divider, start, pause,<br>resume, stop, summary"]
    L2 --> E
    E --> F{"suppress recovery?"}
    F -- Yes --> F2["skip checkAndRecover<br>→ active session = null"]
    F -- No --> F0["checkAndRecover(logRepo)"]
    F0 --> F1{"last session open?"}
    F1 -- No --> F2b["return null"]
    F1 -- Yes --> F3["show QuickPick<br>(stop / pause / resume)"]
    F3 --> F4["append recovery event(s)<br>via repo.appendValidated"]
    F4 --> F5["return recovered Session or null"]
    F2 --> G
    F2b --> G
    F5 --> G
    G["runtime.setActiveSession()<br>→ updateStatusBar,<br>start/stop timer"]
    G --> H["register commands<br>(start, pause, resume, stop,<br>dashboard, addJob,<br>renameJob, deleteJob,<br>showBuildInfo)"]

    style A fill:#5b21b6,stroke:#333,color:#fff
    style F3 fill:#92400e,stroke:#333,color:#fff
    style L2 fill:#92400e,stroke:#333,color:#fff
    style G fill:#065f46,stroke:#333,color:#fff
    style H fill:#1e3a5f,stroke:#333,color:#fff
```

**Key points:**
- `Runtime` is the single owner of paths, repositories, cached `EventCollection`, active `Session`, timer interval, and UI items.
- Every `registry.json` writer (registration, decline, undecline) goes through `RegistryRepository.update(mutate)` — reload fresh from disk, apply the intent, atomic write — so a concurrent window's write is never clobbered and removals are never resurrected (#47).
- The per-repo instance lock (#47) is acquired right after registration; a **live** foreign lock (another window's heartbeat still fresh) triggers a warning and suppresses this window's orphan-recovery pass — the open session belongs to the live window, not a crash. A stale lock (3 missed heartbeats, 90s) is taken over silently.
- `checkAndRecover` reads the last session from this window's owned stores (workspace + scratch) via `EventRepository.loadLastSession("both")`. If the session is open (last event is not `stop`), the user is prompted. Recovery events flow through the same `appendValidated` path as normal commands.
- No background timer starts unless a session is active after recovery.

---


## 2. Session State Machine

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Running : start
    Running --> Paused : pause
    Paused --> Running : resume
    Running --> Idle : stop
    Paused --> Idle : stop
```

State is tracked by the `Session` domain object (`src/core/session.ts`):

| State | `session.isOpen` | `session.isRunning` | `session.isPaused` |
| :--- | :--- | :--- | :--- |
| Idle | `false` | — | — |
| Running | `true` | `true` | `false` |
| Paused | `true` | `false` | `true` |

`Runtime.setActiveSession(session)` drives all side-effects: `updateStatusBar` toggles button visibility, and `startTimerInterval` / `stopTimerInterval` manage the 1-second refresh.

---


## 3. Command Flow

```mermaid
sequenceDiagram
    participant User
    participant Ext as extension.ts
    participant Sess as Session
    participant Repo as EventRepository
    participant RT as Runtime

    User->>Ext: timescope.start
    Ext->>Sess: Session.start(job)
    Sess-->>Ext: startEvent
    Ext->>Repo: appendValidated(startEvent)
    Ext->>RT: appendToCache(startEvent)
    Ext->>RT: setActiveSession(session)
    RT-->>RT: updateStatusBar + startTimerInterval
```

All four session commands (start, pause, resume, stop) follow the same pattern:
1. Mutate the in-memory `Session` (produces an `Event`).
2. Persist via `EventRepository.appendValidated` (writes to the single owning log — workspace when opted in, else scratch — replicates into the derived index, with a dedup check).
3. Push the event into `Runtime`'s cached `EventCollection` (avoids a full file re-parse).
4. Call `setActiveSession` to sync UI and timer.

**Stop** additionally prompts for an optional task description.

---


## 4. Recovery Flow

```mermaid
flowchart TD
    A["checkAndRecover(repo, shutdownTs?)"] --> B["repo.loadLastSession('both')<br>owned: workspace + scratch"]
    B --> C{"session<br>open?"}
    C -- No --> Z["return null"]
    C -- Yes --> TS["atShutdown =<br>shutdownTs ?? lastTimestamp + 1"]
    TS --> D{"accumulating?<br>last event = start | resume"}
    D -- Yes --> QP1["QuickPick — 6 choices<br>dismiss default: stop @ shutdown"]
    D -- "No (paused)" --> QP2["QuickPick — 3 choices<br>dismiss default: stay paused"]
    QP1 & QP2 --> SEL{"user selection"}
    SEL -- "Close session" --> STOP["append stop event<br>return null"]
    SEL -- "Pause session" --> PAUSE["append pause event<br>return loadLastSession"]
    SEL -- "Resume w/ break" --> BREAK["if running: pause + resume<br>if paused: resume only<br>return loadLastSession"]
    SEL -- "Resume / Stay" --> NOOP["resume at last time<br>or no-op<br>return loadLastSession"]

    style A fill:#5b21b6,stroke:#333,color:#fff
    style TS fill:#1e3a5f,stroke:#333,color:#fff
    style QP1 fill:#92400e,stroke:#333,color:#fff
    style QP2 fill:#92400e,stroke:#333,color:#fff
    style STOP fill:#7f1d1d,stroke:#333,color:#fff
    style PAUSE fill:#065f46,stroke:#333,color:#fff
    style BREAK fill:#065f46,stroke:#333,color:#fff
    style NOOP fill:#065f46,stroke:#333,color:#fff
```

### Shutdown Timestamp Resolution

The extension tracks when VS Code was last alive via two `globalState` keys:

| Key | Writer | Frequency |
| :--- | :--- | :--- |
| `timescope.lastSeen` | heartbeat `setInterval` | every 30 s + once on activation |
| `timescope.lastShutdown` | `deactivate()` | once on graceful shutdown |

On activation, recovery computes `shutdownTs = max(lastSeen, lastShutdown)`. This gives exact timing for graceful shutdowns and ±30 s accuracy for crashes/kills. When neither key exists (first run), the fallback is `lastTimestamp + 1`.

### Selection → Events

| Selection | Timestamp used | Events appended | Return value |
| :--- | :--- | :--- | :--- |
| Close @ shutdown | `atShutdown` | `stop` | `null` |
| Close @ now | `Date.now()` | `stop` | `null` |
| Pause @ shutdown | `atShutdown` | `pause` | recovered `Session` |
| Pause @ now | `Date.now()` | `pause` | recovered `Session` |
| Resume with break | `atShutdown` (pause) + `Date.now()` (resume) | `pause` + `resume` (running) or `resume` only (paused) | recovered `Session` |
| Resume no break | `lastTimestamp` | `resume` (if paused) | recovered `Session` |
| Stay paused | — | none | recovered `Session` |

- All timestamps pass through `ensureAfter(lastTimestamp, requested)` to guarantee monotonic ordering.
- If the user dismisses the QuickPick, the default is: **stop @ shutdown** (if accumulating) or **stay paused** (if paused).

---


## 5. Domain Model

```mermaid
classDiagram
    class Event {
        -_id : string
        -_type : EventType
        -_job : Job
        -_timestamp : number
        -_task : string
        -_time_seed : number
        -_global_line_index : number
        -_workspace_line_index : number
        +create(job, type, ts, task)$ Event
        +fromDTO(dto)$ Event
        +fromJSONL(line)$ Event
        +generate_record_id()$ string
        +toDTO() EventDTO
        +toJSONL() string
        +withJob(job) Event
        +withTimestamp(ts) Event
        +withTask(task) Event
        +isStart() boolean
        +isStop() boolean
        +isPause() boolean
        +isResume() boolean
        +isTerminal() boolean
        +isTransitionAllowed(next) boolean
        +validateTransition(next) ValidationError
        +durationUntil(next) number
        +equals(other) boolean
    }
    class EventCollection {
        -_events : Event[]
        +fromArray(events)$ EventCollection
        +fromLines(lines)$ EventCollection
        +parse_lines(lines)$ EventCollection
        +toLines() string[]
        +serialize() string
        +filterByJob(job) EventCollection
        +sorted() Event[]
        +add(event) void
        +firstEvent() Event
        +lastEvent() Event
        +find(predicate) Event
        +toEvents() Event[]
        +replaceEvent(old, nw) EventCollection
        +withUpdatedJob(job) EventCollection
        +validateReplacement(old, nw) ValidationError[]
        +validateReplacements(pairs) ValidationError[]
        +retimeEvent(event, ts) EventCollection
        +updateEvent(old, nw) EventCollection
        +rewrite(globalPath, wsPath) void
        +validate() ValidationError[]
        +currentState() string
    }
    class Job {
        -_id : string
        -_title : string
        -_seed : string
        -_archived : boolean
        -_createdAt : number
        -_lastModifiedAt : number
        -_partial : boolean
        +create(props)$ Job
        +fromEventFields(id, title)$ Job
        +rename(newTitle) Job
        +archive() Job
        +unarchive() Job
        +toRecord() JobRecord
        +equals(other) boolean
    }
    class JobCollection {
        -_jobs : Job[]
        +fromArray(jobs)$ JobCollection
        +size() number
        +isEmpty() boolean
        +findById(id) Job
        +hasId(id) boolean
        +add(job) JobCollection
        +remove(id) JobCollection
        +update(job) JobCollection
        +rename(id, title) JobCollection
        +filterArchived() JobCollection
        +filterActive() JobCollection
    }
    class Session {
        -_job : Job
        -_events : EventCollection
        +fromEvents(events)$ Session
        +fromCollection(col)$ Session
        +isOpen : boolean
        +isRunning : boolean
        +isPaused : boolean
        +isStopped : boolean
        +start(ts) Event
        +pause(ts) Event
        +resume(ts) Event
        +stop(task, ts) Event
        +appendEvent(event) void
        +elapsed() number
        +totalElapsed() number
        +equals(other) boolean
        +toEventCollection() EventCollection
    }
    class Runtime {
        +paths : TimeScopePaths
        +jobs : JobCollection
        +jobRepo : JobRepository
        +logRepo : EventRepository
        +activeSession : Session
        +timerInterval : Timeout
        +ui : StatusBarItems
        +loadEventCollection() EventCollection
        +refreshEventCollection() EventCollection
        +invalidateEventCollection() void
        +appendToCache(event) void
        +renameJob(job, title) void
        +initializeUI() void
        +loadJobs() void
        +setActiveSession(s) void
    }

    Runtime --> Session
    Runtime --> JobCollection
    Runtime --> "1" EventCollection : cached
    Runtime --> JobRepository
    Runtime --> EventRepository
    Session --> Job
    Session --> EventCollection
    EventCollection --> "*" Event
    JobCollection --> "*" Job
    Event --> Job
```

All domain objects are **immutable** (mutations return new instances). `Runtime` is the only mutable coordinator. `Job._partial` marks instances reconstructed from event fields only (via `fromEventFields`) — they lack full metadata and should not be persisted to `jobs.json`.

See [Record Format Spec](record_format_spec.md) for the on-disk `EventDTO` / `JobDTO` shapes and [Record ID Spec](record_id_spec.md) for deterministic ID derivation.

---


## 6. File I/O

**Local-first (#48):** one owner per event. An opted-in repo's committed `.timescope/logs.jsonl`
owns its events; every off-project session is owned by the global `scratch.jsonl`. The global
`index.jsonl` is a **derived, rebuildable** union of all owned sources and is the dashboard's read
surface. The legacy global `logs.jsonl` was migrated into scratch and retired.

```mermaid
flowchart LR
    subgraph Cache ["Runtime Cache"]
        RC["_cachedCollection<br>(index view)"]
    end

    subgraph Repos ["Repositories"]
        ER["EventRepository"]
        JR["JobRepository"]
    end

    subgraph Global ["Global Storage"]
        JF["jobs.json"]
        SC["scratch.jsonl<br>(OWNED: off-project<br>+ migrated legacy)"]
        IX["index.jsonl<br>(DERIVED, rebuildable)"]
        RG["registry.json"]
    end

    subgraph WS ["Workspace Storage (opted-in repo)"]
        WL[".timescope/logs.jsonl<br>(OWNED)"]
    end

    ER -- "append (opted-in owner)" --> WL
    ER -- "append (off-project owner)" --> SC
    ER -- "replicate every event" --> IX
    WL -- "rebuild (walk registry)" --> IX
    SC -- "rebuild" --> IX
    RG -. "repo paths" .-> IX
    RC -. "load / refresh (dashboard)" .-> IX
    ER -- "loadAllEntries (owned: scratch+ws)" --> SC & WL

    JR -- "save / update / delete" --> JF
    JR -- "loadAll" --> JF
```

| Operation | Reads | Writes |
| :--- | :--- | :--- |
| Session command (start/pause/resume/stop) | owned (workspace **or** scratch) | owning log + `index.jsonl` |
| Recovery | owned (workspace + scratch) | owning log + `index.jsonl` |
| Dashboard `request_data` | `index.jsonl` (derived) | — |
| Dashboard edit | owned (find) / `index.jsonl` (display) | owning log, then rebuild `index.jsonl` |
| Rename job | owned logs | owned logs, `index.jsonl`, `jobs.json` |
| Rebuild Global Index | registry repo logs + scratch | `index.jsonl` |
| Migration (once, on activation) | legacy `logs.jsonl` | `scratch.jsonl` (+ `.migrated.bak`) |
| Add/delete job | — | `jobs.json` |

- **One owner per event.** `appendEvent` writes to exactly one owned log — the workspace log when
  opted in, otherwise scratch — then replicates into the derived `index.jsonl` (no dual-write).
- `EventRepository.loadAllEntries()` is the **owned** view (scratch + workspace, deduped by event
  ID) used for recovery/edits; `loadIndexEntries()` is the **derived** view the dashboard displays.
- Editing resolves the target event in the owned view and rewrites its owning log, then the index
  is rebuilt. Editing events owned by *other* repos waits for #43 (amend).
- `Runtime` caches the index view; `appendToCache` avoids a full re-parse after each write.
- `JobRepository` has **no** workspace mirror — jobs are stored only in global `jobs.json`.

---


## 7. Dashboard

```mermaid
sequenceDiagram
    participant WV as dashboard.js<br>(webview)
    participant Ctrl as dashboard.ts<br>(controller)
    participant Utils as dashboard_utils.ts
    participant RT as Runtime

    WV->>Ctrl: request_data
    Ctrl->>RT: refreshEventCollection()
    RT-->>Ctrl: EventCollection
    Ctrl->>Utils: buildPayload(events)
    Utils-->>Ctrl: payload[]
    Ctrl->>Ctrl: format_build_info_full(runtime.buildInfo)
    Ctrl-->>WV: summary_data { payload, build_info }

    WV->>Ctrl: edit_log_entry
    Ctrl->>RT: loadEventCollection()
    RT-->>Ctrl: EventCollection (cached)
    Ctrl->>Ctrl: Event.fromDTO(new_record)
    Ctrl->>Ctrl: collection.validateReplacement(old, new)
    Ctrl->>RT: logRepo.replaceEvent(old, new)
    Ctrl->>RT: refreshEventCollection()
    RT-->>Ctrl: updated EventCollection
    Ctrl->>Ctrl: collection.validate()
    Ctrl->>Utils: filterRelevantErrors(errors, edited)
    Utils-->>Ctrl: relevant error strings
    Ctrl->>Utils: buildPayload(events)
    Utils-->>Ctrl: payload[]
    Ctrl-->>WV: edit_result { summary, payload }
```

- `dashboard_utils.ts` exports two pure functions: `buildPayload()` (timestamp-descending DTO array) and `filterRelevantErrors()` (scopes validation errors to the edited events).
- `filter_state.js` (webview) holds the pure filter/sort logic behind the summary view: one filter-state object (date range, jobs, duration/pause ranges, source, sort) that `dashboard.js` renders from. Date presets resolve into explicit `start_day`/`end_day` bounds; `source` (merged/global/workspace) is wired through the filter model as the seam for issue #3, with no UI yet. Loaded as a plain `<script>` in the webview and `require()`d directly by the pure-Node test suite (`src/test/test_filter_state.ts`).
- `build_info.ts` exports `load_build_info()` (reads `out/buildinfo.json`, `null` if missing/malformed) and formatters `format_status_bar_suffix()` / `format_build_info_full()` (the latter composed from the former). `Runtime` loads it once at construction; the status-bar tooltip, dashboard footer, and the Show Build Info command all render it, with a "no build info" fallback.
- The controller routes all data access through `Runtime` — never directly to `EventRepository`.
- `edit_log_entries` (batch edit) follows the same pattern per-edit, with per-item error accumulation.
- The dashboard panel uses `retainContextWhenHidden` so it stays alive when the tab loses focus.
- The controller does **not** push data proactively — all updates are triggered by webview messages.

---


## 8. Timer & Status Bar

```mermaid
flowchart TD
    A["setActiveSession(session)"] --> B["updateStatusBar(runtime)<br>→ toggle button visibility"]
    A --> C{"session open?"}
    C -- Yes --> D["startTimerInterval<br>setInterval 1000 ms"]
    C -- No --> E["stopTimerInterval<br>clearInterval"]
    D --> F["updateTimerText<br>→ divider.text = elapsed"]

    style A fill:#5b21b6,stroke:#333,color:#fff
    style D fill:#065f46,stroke:#333,color:#fff
    style E fill:#7f1d1d,stroke:#333,color:#fff
```

- `updateTimerText` reads `session.elapsed()` (handles paused intervals) and formats as `Xh Ym`.
- The timer is managed by `Runtime`; `timer.ts` contains only pure helper functions.

---


## Related Documentation

| Document | Description |
| :--- | :--- |
| [README.md](../README.md) | User-facing overview, commands, settings |
| [DEVELOPMENT.md](../DEVELOPMENT.md) | Build, test, feature & release workflow |
| [record_format_spec.md](record_format_spec.md) | On-disk format for `jobs.json` and `logs.jsonl` |
| [record_id_spec.md](record_id_spec.md) | Deterministic record ID derivation (FNV-1a, base-36) |
| [coding_standards.md](../coding_standards.md) | Project coding conventions |
