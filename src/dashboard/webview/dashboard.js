console.log("dashboard.js loaded");

const vscode = acquireVsCodeApi();

// Request data from extension
vscode.postMessage({
    type: "request_data"
});

let all_sessions = [];
let pie_chart_instance = null;
let stacked_chart_instance = null;
let hasRenderedJobFilter = false;

// ---------------------------------------------------------------------
// MESSAGE HANDLER
// ---------------------------------------------------------------------

window.addEventListener("message", (event) => {
    const msg = event.data;

    if (msg.type === "summary_data") {
        const rawEvents = msg.payload || [];

        // 1) Normalize raw events into a canonical shape
        const events = normalize_events(rawEvents);

        // 2) Build sessions from start/pause/resume/stop event stream
        all_sessions = build_sessions_from_events(events);

        // 3) Initial render + filter hookup
        render_dashboard(all_sessions);
        attach_filter_listeners();
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
            }
        },
        plugins: [ChartDataLabels]
    });
}

// ---------------------------------------------------------------------
// RAW SESSION TABLE
// ---------------------------------------------------------------------

function render_session_table(sessions) {
    const body = document.getElementById("session_table_body");
    if (!body) return;

    body.innerHTML = "";

    sessions.forEach(s => {
        const tr = document.createElement("tr");

        const day = get_local_day(s.start);

        const start_local = new Date(s.start).toLocaleString();
        const stop_local = new Date(s.stop).toLocaleString();

        tr.innerHTML =
            `<td>${day}</td>` +
            `<td>${s.job}</td>` +
            `<td>${(s.duration_ms / 3600000).toFixed(2)}h</td>` +
            `<td>${s.task || ""}</td>` +
            `<td>${start_local}</td>` +
            `<td>${stop_local}</td>`;

        body.appendChild(tr);
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