console.log("dashboard.js loaded");

const vscode = acquireVsCodeApi();

// Request data from extension
vscode.postMessage({
    type: "request_data"
});

let all_sessions = [];
let all_events = []; // ascending events used to build sessions and compute pause/resume
let eventOccurrencesMap = new Map(); // key -> occurrences array
let pie_chart_instance = null;
let stacked_chart_instance = null;
let hasRenderedJobFilter = false;

// Current highlighted job/day (for toggle behavior)
let current_highlight = null;

// ---------------------------------------------------------------------
// MESSAGE HANDLER
// ---------------------------------------------------------------------

window.addEventListener("message", (event) => {
    const msg = event.data;

    if (msg.type === "summary_data") {
        const payload = msg.payload || [];

        // payload is an array of grouped events { event, job, timestamp, task, occurrences }

        // Build canonical events array (ascending order) for session construction
        const eventsAsc = payload
            .map(e => ({ event: e.event, job: e.job, task: e.task, timestamp: e.timestamp }))
            .sort((a, b) => a.timestamp - b.timestamp);

        // keep all_events for pause/resume counts and session edit mapping
        all_events = eventsAsc;

        // Build occurrences map for quick lookup when editing
        eventOccurrencesMap = new Map();
        payload.forEach(e => {
            const key = `${e.event}|${e.job}|${e.timestamp}|${e.task || ""}`;
            eventOccurrencesMap.set(key, e.occurrences || []);
        });

        // 2) Build sessions from start/pause/resume/stop event stream
        all_sessions = build_sessions_from_events(eventsAsc);

        // 3) Initial render + filter hookup
        render_dashboard(all_sessions);
        attach_filter_listeners();

        // Event log removed; session-based editing is available via Edit buttons in the Sessions table.
    }

    if (msg.type === "edit_result") {
        const result = msg.payload && msg.payload.summary ? msg.payload.summary : {};
        const payload = msg.payload && msg.payload.payload ? msg.payload.payload : [];

        // Re-enable Save button if present
        const save = document.getElementById('session_edit_save');
        if (save) { save.disabled = false; save.textContent = 'Save'; }

        if (result && result.errors && result.errors.length > 0) {
            // Show inline errors in the session modal
            const errorBox = document.getElementById('session_error');
            if (errorBox) {
                errorBox.style.display = '';
                errorBox.textContent = result.errors.join('\n');
                errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                alert("Edit failed: " + result.errors.join("; "));
            }
            return;
        }

        // success — refresh UI with new payload
        const eventsAsc = payload.map(e => ({ event: e.event, job: e.job, task: e.task, timestamp: e.timestamp })).sort((a, b) => a.timestamp - b.timestamp);
        all_sessions = build_sessions_from_events(eventsAsc);
        render_dashboard(all_sessions);
        // Close session edit modal if open
        close_session_modal();
    }
});

// ---------------------------------------------------------------------
// NORMALIZATION: RAW EVENTS → CANONICAL EVENTS
// ---------------------------------------------------------------------

function normalize_events(rawEvents) {
    // 1) Normalize
    let events = rawEvents
        .map(e => {
            const evt = e.event || e.type;
            const job = e.job || "";
            const task = e.task || "";

            const tsRaw = e.timestamp;
            let ts;
            if (typeof tsRaw === "number") ts = tsRaw;
            else if (typeof tsRaw === "string") {
                if (/^\d+$/.test(tsRaw.trim())) ts = Number(tsRaw);
                else ts = Date.parse(tsRaw);
            } else ts = NaN;

            return { event: evt, job, task, timestamp: ts };
        })
        .filter(e =>
            e.event &&
            e.job &&
            typeof e.timestamp === "number" &&
            !Number.isNaN(e.timestamp)
        );

    // 2) DEDUPE (fixes global+workspace mirror duplication)
    const seen = new Set();
    events = events.filter(e => {
        const key = `${e.event}|${e.job}|${e.timestamp}|${e.task || ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // 3) Sort
    events.sort((a, b) => a.timestamp - b.timestamp);

    return events;
}

// ---------------------------------------------------------------------
// SESSION RECONSTRUCTION: EVENTS → SESSIONS
// ---------------------------------------------------------------------
//
// We support:
//   start → stop
//   start → pause → resume → stop
//   start → pause → resume → pause → resume → stop
//
// Each job has its own state; we assume you’re not running the same job
// concurrently in multiple overlapping sessions.

function build_sessions_from_events(events) {
    const sessions = [];

    // Per-job state machine
    const stateByJob = new Map();

    function ensureState(job) {
        if (!stateByJob.has(job)) {
            stateByJob.set(job, {
                currentSession: null,
                lastActiveStart: null,
                accumulatedMs: 0,
                inPause: false
            });
        }
        return stateByJob.get(job);
    }

    function finalizeSession(job, stopTs, stopTask) {
        const state = stateByJob.get(job);
        if (!state || !state.currentSession) return;

        // If we're active when we hit stop, add final active segment
        if (!state.inPause && state.lastActiveStart != null) {
            state.accumulatedMs += stopTs - state.lastActiveStart;
        }

        const duration_ms = Math.max(0, state.accumulatedMs);

        sessions.push({
            job,
            start: state.currentSession.start,
            stop: stopTs,
            duration_ms,
            task: stopTask || state.currentSession.task || ""
        });

        // Reset state for this job
        state.currentSession = null;
        state.lastActiveStart = null;
        state.accumulatedMs = 0;
        state.inPause = false;
    }

    for (const e of events) {
        const job = e.job;
        const ts = e.timestamp;
        const evt = (e.event || "").toLowerCase();

        const state = ensureState(job);

        switch (evt) {
            case "start": {
                // If there is a dangling session, finalize it at this new start
                if (state.currentSession) {
                    finalizeSession(job, ts, state.currentSession.task);
                }
                state.currentSession = {
                    job,
                    start: ts,
                    task: e.task || ""
                };
                state.lastActiveStart = ts;
                state.accumulatedMs = 0;
                state.inPause = false;
                break;
            }

            case "pause": {
                if (state.currentSession && !state.inPause && state.lastActiveStart != null) {
                    state.accumulatedMs += ts - state.lastActiveStart;
                    state.lastActiveStart = null;
                    state.inPause = true;
                }
                break;
            }

            case "resume": {
                if (state.currentSession && state.inPause) {
                    state.inPause = false;
                    state.lastActiveStart = ts;
                }
                break;
            }

            case "stop": {
                if (state.currentSession) {
                    finalizeSession(job, ts, e.task);
                }
                break;
            }

            default:
                // ignore unknown events
                break;
        }
    }

    // We intentionally ignore open sessions with no stop event

    return sessions.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------
// FILTER LISTENERS
// ---------------------------------------------------------------------

function attach_filter_listeners() {
    const preset = document.getElementById("preset_range");
    if (preset && !preset.dataset.bound) {
        preset.addEventListener("change", apply_filters_and_render);
        preset.dataset.bound = "true";
    }

    const clearBtn = document.getElementById("clear_filters_btn");
    if (clearBtn && !clearBtn.dataset.bound) {
        clearBtn.addEventListener("click", clear_filters);
        clearBtn.dataset.bound = "true";
    }

    // “All” checkbox
    const allBox = document.getElementById("job_all_checkbox");
    if (allBox && !allBox.dataset.bound) {
        allBox.addEventListener("change", () => {
            const checked = allBox.checked;
            document
                .querySelectorAll("#job_filter_container .job-box")
                .forEach(box => {
                    box.checked = checked;
                });
            apply_filters_and_render();
        });
        allBox.dataset.bound = "true";
    }

    // Individual job boxes
    document
        .querySelectorAll("#job_filter_container .job-box")
        .forEach(box => {
            if (!box.dataset.bound) {
                box.addEventListener("change", () => {
                    const allBox = document.getElementById("job_all_checkbox");
                    const allJobs = [
                        ...document.querySelectorAll("#job_filter_container .job-box")
                    ];
                    const allChecked = allJobs.every(b => b.checked);
                    if (allBox) {
                        allBox.checked = allChecked;
                    }
                    apply_filters_and_render();
                });
                box.dataset.bound = "true";
            }
        });
}

// ---------------------------------------------------------------------
// MAIN FILTER PIPELINE
// ---------------------------------------------------------------------

function apply_filters_and_render() {
    const filtered = filter_sessions(all_sessions);
    render_dashboard(filtered);
}

// ---------------------------------------------------------------------
// DATE + JOB FILTERING
// ---------------------------------------------------------------------

function filter_sessions(sessions) {
    const presetEl = document.getElementById("preset_range");
    const preset = presetEl ? presetEl.value : "this_month";

    const now = new Date();
    const today_local = get_local_day(now.getTime());

    let start_date = null;
    let end_date = null;

    if (preset === "today") {
        start_date = today_local;
        end_date = today_local;
    }

    if (preset === "this_week") {
        const day = now.getDay();
        const monday = new Date(now);
        monday.setDate(now.getDate() - ((day + 6) % 7));
        start_date = get_local_day(monday.getTime());
        end_date = today_local;
    }

    if (preset === "last_7") {
        const d = new Date(now);
        d.setDate(now.getDate() - 6);
        start_date = get_local_day(d.getTime());
        end_date = today_local;
    }

    if (preset === "this_month") {
        const first = new Date(now.getFullYear(), now.getMonth(), 1);
        start_date = get_local_day(first.getTime());
        end_date = today_local;
    }

    if (preset === "last_3_months") {
        const d = new Date(now);
        d.setMonth(now.getMonth() - 2);
        const first = new Date(d.getFullYear(), d.getMonth(), 1);
        start_date = get_local_day(first.getTime());
        end_date = today_local;
    }

    let date_filtered = sessions;

    if (start_date && end_date) {
        date_filtered = sessions.filter(s => {
            const day = get_local_day(s.start);
            return day >= start_date && day <= end_date;
        });
    }

    // JOB FILTERING — only job boxes, ignore "All"
    const selected_jobs = [
        ...document.querySelectorAll("#job_filter_container .job-box:checked")
    ].map(b => b.value);

    if (selected_jobs.length === 0) {
        return [];
    }

    return date_filtered.filter(s => selected_jobs.includes(s.job));
}

// ---------------------------------------------------------------------
// DASHBOARD RENDERER
// ---------------------------------------------------------------------

function render_dashboard(sessions) {
    render_job_filter(all_sessions);
    attach_filter_listeners();
    render_pie_chart(sessions);
    render_stacked_bar_chart(sessions);
    render_session_table(sessions);
}

// ---------------------------------------------------------------------
// JOB FILTER CHECKBOXES (WITH “ALL”)
// ---------------------------------------------------------------------

function render_job_filter(allSessions) {
    const container = document.getElementById("job_filter_container");
    if (!container) return;

    // Capture previous selections (job boxes only)
    const previouslyChecked = new Set(
        [...container.querySelectorAll("input.job-box")]
            .filter(b => b.checked)
            .map(b => b.value)
    );

    container.innerHTML = "";

    const jobs = [...new Set(allSessions.map(s => s.job))];

    // Determine if "All" should be checked:
    // - first render → true
    // - later renders → true if every job was checked previously
    let allShouldBeChecked;
    if (!hasRenderedJobFilter) {
        allShouldBeChecked = true;
    } else {
        allShouldBeChecked =
            jobs.length > 0 &&
            jobs.every(job => previouslyChecked.has(job));
    }

    // "All" checkbox
    const allDiv = document.createElement("div");
    allDiv.innerHTML =
        `<label><input type="checkbox" id="job_all_checkbox" ${allShouldBeChecked ? "checked" : ""}> All</label>`;
    container.appendChild(allDiv);

    // Job checkboxes
    jobs.forEach(job => {
        const div = document.createElement("div");

        let checked;
        if (!hasRenderedJobFilter) {
            // First render → all checked
            checked = true;
        } else if (previouslyChecked.size === 0) {
            checked = allShouldBeChecked;
        } else {
            checked = previouslyChecked.has(job);
        }

        div.innerHTML =
            `<label><input type="checkbox" class="job-box" value="${job}" ${checked ? "checked" : ""}> ${job}</label>`;

        container.appendChild(div);
    });

    hasRenderedJobFilter = true;
}

// ---------------------------------------------------------------------
// CLEAR FILTERS
// ---------------------------------------------------------------------

function clear_filters() {
    const preset = document.getElementById("preset_range");
    if (preset) {
        preset.value = "this_month";
    }

    // Re-check "All" and all jobs
    const allBox = document.getElementById("job_all_checkbox");
    if (allBox) {
        allBox.checked = true;
    }

    document
        .querySelectorAll("#job_filter_container .job-box")
        .forEach(box => {
            box.checked = true;
        });

    apply_filters_and_render();
}

// ---------------------------------------------------------------------
// PIE CHART
// ---------------------------------------------------------------------

function render_pie_chart(sessions) {
    const ctx = document.getElementById("pie_chart");
    if (!ctx) return;

    const totals_by_job = {};
    sessions.forEach(s => {
        totals_by_job[s.job] = (totals_by_job[s.job] || 0) + s.duration_ms;
    });

    const jobs = Object.keys(totals_by_job);
    const hours = jobs.map(j => totals_by_job[j] / 3600000);

    if (pie_chart_instance) pie_chart_instance.destroy();

    pie_chart_instance = new Chart(ctx, {
        type: "pie",
        data: {
            labels: jobs,
            datasets: [{
                data: hours,
                backgroundColor: generate_color_palette(jobs.length)
            }]
        },
        options: {
            plugins: {
                datalabels: {
                    formatter: (value) => value.toFixed(1) + "h",
                    color: "#fff",
                    font: { weight: "bold" }
                }
            }
        },
        plugins: [ChartDataLabels]
    });
}

// ---------------------------------------------------------------------
// STACKED BAR CHART
// ---------------------------------------------------------------------

function render_stacked_bar_chart(sessions) {
    const ctx = document.getElementById("stacked_bar_chart");
    if (!ctx) return;

    const map = {};
    sessions.forEach(s => {
        const day = get_local_day(s.start);
        map[day] = map[day] || {};
        map[day][s.job] = (map[day][s.job] || 0) + s.duration_ms;
    });

    const days = Object.keys(map).sort((a, b) => new Date(a) - new Date(b));
    const jobs = [...new Set(sessions.map(s => s.job))];

    const palette = generate_color_palette(jobs.length);

    const datasets = jobs.map((job, idx) => ({
        label: job,
        data: days.map(d => (map[d][job] || 0) / 3600000),
        backgroundColor: palette[idx]
    }));

    const totals_per_day = days.map(d =>
        jobs.reduce((sum, job) => sum + ((map[d][job] || 0) / 3600000), 0)
    );

    const max_total = Math.max(...totals_per_day, 1);
    const padded_max = max_total * 1.2;

    if (stacked_chart_instance) stacked_chart_instance.destroy();

    stacked_chart_instance = new Chart(ctx, {
        type: "bar",
        data: { labels: days, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    suggestedMax: padded_max
                }
            },
            plugins: {
                legend: { position: "right" },
                datalabels: {
                    color: "#fff",
                    font: { weight: "bold" },
                    clip: false,
                    offset: 4,
                    formatter: (value, ctx) => {
                        if (!value) return "";
                        const last = ctx.chart.data.datasets.length - 1;
                        if (ctx.datasetIndex === last) {
                            const total = totals_per_day[ctx.dataIndex];
                            return total.toFixed(1) + "h";
                        }
                        return value.toFixed(1) + "h";
                    },
                    anchor: (ctx) =>
                        ctx.datasetIndex === ctx.chart.data.datasets.length - 1
                            ? "end"
                            : "center",
                    align: (ctx) =>
                        ctx.datasetIndex === ctx.chart.data.datasets.length - 1
                            ? "end"
                            : "center"
                }
            },
            // Click handler: highlight session rows for clicked job/day
            onClick: (evt, elements) => {
                if (!elements || elements.length === 0) return;
                const el = elements[0];
                const datasetIndex = el.datasetIndex;
                const index = el.index;
                const job = stacked_chart_instance.data.datasets[datasetIndex].label;
                const day = stacked_chart_instance.data.labels[index];

                // Toggle: if same as current highlight -> clear, else highlight new
                if (current_highlight && current_highlight.job === String(job).trim() && current_highlight.day === String(day).trim()) {
                    clear_session_highlights();
                    current_highlight = null;
                } else {
                    highlight_session_rows(job, day);
                    current_highlight = { job: String(job).trim(), day: String(day).trim() };
                }
            }
        },
        plugins: [ChartDataLabels]
    });
}

// ---------------------------------------------------------------------
// RAW SESSION TABLE
// ---------------------------------------------------------------------


// ----- Session edit modal -----
function open_session_edit_modal(session) {
    const container = document.getElementById('session_events_container');
    const errorBox = document.getElementById('session_error');
    if (errorBox) { errorBox.style.display = 'none'; errorBox.textContent = ''; }

    container.innerHTML = '';

    // Find events for this session (inclusive)
    const events = all_events.filter(e => e.job === session.job && e.timestamp >= session.start && e.timestamp <= session.stop).sort((a,b)=>a.timestamp - b.timestamp);

    events.forEach((e, idx) => {
        const key = `${e.event}|${e.job}|${e.timestamp}|${e.task || ''}`;
        const occurrences = eventOccurrencesMap.get(key) || [];

        const row = document.createElement('div');
        row.className = 'session-event-row';
        row.innerHTML = `
            <div class="e-label">${e.event}</div>
            <div class="e-ts"><input type="datetime-local" data-idx="${idx}"></div>
            <div class="e-task"><input type="text" data-idx="${idx}" value="${e.event === 'stop' ? (e.task || '') : ''}"></div>
        `;

        // store metadata on row for save
        row._meta = { key, e, occurrences };

        // set timestamp input value
        const dtInput = row.querySelector('input[type="datetime-local"]');
        const dt = new Date(e.timestamp);
        dtInput.value = new Date(dt.getTime() - (dt.getTimezoneOffset() * 60000)).toISOString().slice(0,16);

        container.appendChild(row);
    });

    // attach handlers for cancel/save
    const cancel = document.getElementById('session_edit_cancel');
    const save = document.getElementById('session_edit_save');

    if (cancel && !cancel.dataset.bound) {
        cancel.addEventListener('click', () => {
            close_session_modal();
        });
        cancel.dataset.bound = 'true';
    }

    if (save && !save.dataset.bound) {
        save.addEventListener('click', () => {
            const edits = [];
            const rows = Array.from(container.querySelectorAll('.session-event-row'));
            for (const r of rows) {
                const meta = r._meta;
                const tsInput = r.querySelector('input[type="datetime-local"]');
                const taskInput = r.querySelector('.e-task input');
                const newTs = new Date(tsInput.value).getTime();
                const e = meta.e;
                const newRec = { event: e.event, job: e.job, timestamp: newTs };
                if (e.event === 'stop') newRec.task = taskInput.value || '';

                // Only push if changed
                if (newTs !== e.timestamp || (e.event === 'stop' && (newRec.task || '') !== (e.task || ''))) {
                    edits.push({ occurrences: meta.occurrences, new_record: newRec });
                }
            }

            if (edits.length === 0) { close_session_modal(); return; }

            // UI: disable save and show progress
            save.disabled = true;
            const prevText = save.textContent;
            save.textContent = 'Saving…';

            // Clear previous errors
            if (errorBox) { errorBox.style.display = 'none'; errorBox.textContent = ''; }

            vscode.postMessage({ type: 'edit_log_entries', payload: { edits } });

            // Leave re-enable to edit_result handler
        });
        save.dataset.bound = 'true';
    }

    document.getElementById('session_edit_modal').style.display = 'block';
}

function close_session_modal() {
    document.getElementById('session_edit_modal').style.display = 'none';
}


function render_session_table(sessions) {
    const body = document.getElementById("session_table_body");
    if (!body) return;

    body.innerHTML = "";

    // Show latest sessions first (reverse chronological)
    const rev = sessions.slice().sort((a, b) => b.start - a.start);

    // Clear any previous highlights
    clear_session_highlights();

    rev.forEach(s => {
        const tr = document.createElement("tr");

        const day = get_local_day(s.start);

        const start_local = new Date(s.start).toLocaleString();
        const stop_local = new Date(s.stop).toLocaleString();

        // Compute pause/resume pair count for this session
        const eventsForSession = all_events.filter(e => e.job === s.job && e.timestamp >= s.start && e.timestamp <= s.stop);
        const pauseCount = eventsForSession.filter(e => e.event === 'pause').length;
        const resumeCount = eventsForSession.filter(e => e.event === 'resume').length;
        const pairs = Math.min(pauseCount, resumeCount);

        const editBtn = `<button class="session-edit-btn" data-job="${s.job}" data-start="${s.start}" data-stop="${s.stop}">Edit</button>`;

        tr.dataset.job = s.job;
        tr.dataset.day = day;

        tr.innerHTML =
            `<td>${day}</td>` +
            `<td>${s.job}</td>` +
            `<td>${(s.duration_ms / 3600000).toFixed(2)}h</td>` +
            `<td>${s.task || ""}</td>` +
            `<td>${start_local}</td>` +
            `<td>${stop_local}</td>` +
            `<td>${pairs}</td>` +
            `<td>${editBtn}</td>`;

        body.appendChild(tr);
    });

    // Attach session edit handlers
    document.querySelectorAll("button.session-edit-btn").forEach(btn => {
        if (!btn.dataset.bound) {
            btn.addEventListener('click', (ev) => {
                const el = ev.currentTarget;
                const job = el.getAttribute('data-job');
                const start = Number(el.getAttribute('data-start'));
                const stop = Number(el.getAttribute('data-stop'));
                open_session_edit_modal({ job, start, stop });
            });
            btn.dataset.bound = 'true';
        }
    });


    // Attach session edit handlers
    document.querySelectorAll("button.session-edit-btn").forEach(btn => {
        if (!btn.dataset.bound) {
            btn.addEventListener('click', (ev) => {
                const el = ev.currentTarget;
                const job = el.getAttribute('data-job');
                const start = Number(el.getAttribute('data-start'));
                const stop = Number(el.getAttribute('data-stop'));
                open_session_edit_modal({ job, start, stop });
            });
            btn.dataset.bound = 'true';
        }
    });
}

// ---------------------------------------------------------------------
// UTILITIES
// ---------------------------------------------------------------------

function generate_color_palette(n) {
    const base = [
        "#4e79a7", "#f28e2b", "#e15759", "#76b7b2",
        "#59a14f", "#edc949", "#af7aa1", "#ff9da7",
        "#9c755f", "#bab0ab"
    ];
    return Array.from({ length: n }, (_, i) => base[i % base.length]);
}

function get_local_day(timestamp) {
    const d = new Date(timestamp);

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;  // local ISO date
}

// Highlight helpers (module-level so chart click handler can call them)
function clear_session_highlights() {
    const rows = document.querySelectorAll('#session_table_body tr.session-highlighted');
    rows.forEach(r => r.classList.remove('session-highlighted'));
    current_highlight = null;
}

function highlight_session_rows(job, day) {
    if (!job || !day) return;
    const jobTrim = String(job).trim();
    const dayTrim = String(day).trim();

    clear_session_highlights();
    const rows = Array.from(document.querySelectorAll('#session_table_body tr'));
    const matched = rows.filter(r => String(r.dataset.job || '').trim() === jobTrim && String(r.dataset.day || '').trim() === dayTrim);
    matched.forEach(r => r.classList.add('session-highlighted'));
    if (matched.length > 0) {
        matched[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}