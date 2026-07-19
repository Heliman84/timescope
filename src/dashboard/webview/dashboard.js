console.log("dashboard.js loaded");

const vscode = acquireVsCodeApi();

// Pure filter/sort logic shared with the Node test suite (filter_state.js).
const Filters = window.TimeScopeFilters;

// Request data from extension
vscode.postMessage({
    type: "request_data"
});

let all_sessions = [];
let all_events = []; // ascending events used to build sessions and compute pause/resume
let eventOccurrencesMap = new Map(); // key -> occurrences array
let pie_chart_instance = null;
let stacked_chart_instance = null;

// One filter state object drives every chart and the table.
let filter_state = Filters.create_default_filter_state(new Date());

// job -> colour, assigned once from the full job list so filtering never
// reshuffles the palette.
let job_color_map = {};

// Current highlighted job/day (for toggle behavior)
let current_highlight = null;

// ---------------------------------------------------------------------
// MESSAGE HANDLER
// ---------------------------------------------------------------------

window.addEventListener("message", (event) => {
    const msg = event.data;

    if (msg.type === "summary_data") {
        const payload = msg.payload || [];

        const footer = document.getElementById('build_info_footer');
        if (footer) footer.textContent = msg.build_info || 'no build info';

        load_payload(payload);

        // Initial render applies the default filter state (Last 14 Days),
        // fixing the old "default preset never applied on load" bug (#31).
        render_date_controls();
        render_filter_controls();
        attach_filter_listeners();
        apply_and_render();
    }

    if (msg.type === "edit_result") {
        const result = msg.payload && msg.payload.summary ? msg.payload.summary : {};
        const payload = msg.payload && msg.payload.payload ? msg.payload.payload : [];

        // Re-enable Save button if present
        const save = document.getElementById('session_edit_save');
        if (save) { save.disabled = false; save.textContent = 'Save'; }

        // --- Show warnings (informational, cross-job overlap) ---
        const warningBox = document.getElementById('session_warning');
        if (warningBox) {
            if (result && result.warnings && result.warnings.length > 0) {
                warningBox.style.display = '';
                const wMsgs = result.warnings.map(w => (typeof w === 'string' ? w : (w.message || JSON.stringify(w))));
                warningBox.textContent = '⚠ ' + wMsgs.join('\n⚠ ');
            } else {
                warningBox.style.display = 'none';
                warningBox.textContent = '';
            }
        }

        // --- Show errors (blocking, same-job sequence violation) ---
        if (result && result.errors && result.errors.length > 0) {
            // Show inline errors in the session modal
            const errorBox = document.getElementById('session_error');
            if (errorBox) {
                errorBox.style.display = '';
                const msgs = result.errors.map(e => (typeof e === 'string' ? e : (e.message || JSON.stringify(e))));
                errorBox.textContent = msgs.join('\n');
                errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                const msgs = result.errors.map(e => (typeof e === 'string' ? e : (e.message || JSON.stringify(e))));
                alert("Edit failed: " + msgs.join("; "));
            }
            return;
        }

        // success — refresh UI with new payload (keeps current filter state)
        load_payload(payload);
        render_filter_controls();
        apply_and_render();

        // If there are warnings but no errors, keep the modal open so the user sees them
        if (result && result.warnings && result.warnings.length > 0) {
            return;
        }
        // Close session edit modal if open
        close_session_modal();
    }
});

// ---------------------------------------------------------------------
// PAYLOAD → SESSIONS
// ---------------------------------------------------------------------

function load_payload(payload) {
    // Canonical events array (ascending) for session construction.
    // Preserve id, job_id, time_seed (edit DTO) and line indices (source seam).
    all_events = payload
        .map(e => ({
            event: e.event,
            job: e.job,
            task: e.task,
            timestamp: e.timestamp,
            id: e.id,
            job_id: e.job_id,
            time_seed: e.time_seed,
            global_line_index: e.global_line_index,
            workspace_line_index: e.workspace_line_index,
            // #15 hierarchy — additive, optional (see attribution.ts's AttributedEventDTO).
            source_repo_id: e.source_repo_id,
            client: e.client,
            project: e.project,
            task_type: e.task_type,
        }))
        .sort((a, b) => a.timestamp - b.timestamp);

    // Occurrences map for the edit modal
    eventOccurrencesMap = new Map();
    payload.forEach(e => {
        const key = `${e.event}|${e.job}|${e.timestamp}|${e.task || ""}`;
        eventOccurrencesMap.set(key, e.occurrences || []);
    });

    all_sessions = build_sessions_from_events(all_events);
    assign_job_colors(all_sessions);
}

// ---------------------------------------------------------------------
// #15 HIERARCHY LABELLING
// ---------------------------------------------------------------------
//
// Each event may carry an additive attribution (see attribution.ts):
// `task_type` (resolved from job_id, direct or alias) and, when the source
// repo is bound, `client`/`project`. hierarchy_label is the single place
// that turns those into the display/grouping string used everywhere a job
// name is shown — the legend, charts, table, and job filter (all driven by
// the shared `job` field on session/event objects, see filter_state.js).
//
// - Client + Project + Task-type all resolved → "Client › Project › Task-type"
// - Task-type resolved but the source repo is unbound → "Task-type" alone
// - Nothing resolvable (legacy/unassigned) → the flat `job` title, unchanged
function hierarchy_label(e) {
    if (e && e.task_type) {
        if (e.client && e.project) {
            return `${e.client.name} › ${e.project.name} › ${e.task_type.name}`;
        }
        return e.task_type.name;
    }
    return e.job;
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
// Each job has its own state; we assume you're not running the same job
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
                inPause: false,
                pausePairs: 0,
                hasGlobal: false,
                hasWorkspace: false
            });
        }
        return stateByJob.get(job);
    }

    function note_source(state, e) {
        if (typeof e.global_line_index === "number" && e.global_line_index >= 0) state.hasGlobal = true;
        if (typeof e.workspace_line_index === "number" && e.workspace_line_index >= 0) state.hasWorkspace = true;
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
            task: stopTask || state.currentSession.task || "",
            pause_pairs: state.pausePairs,
            has_global: state.hasGlobal,
            has_workspace: state.hasWorkspace
        });

        // Reset state for this job
        state.currentSession = null;
        state.lastActiveStart = null;
        state.accumulatedMs = 0;
        state.inPause = false;
        state.pausePairs = 0;
        state.hasGlobal = false;
        state.hasWorkspace = false;
    }

    for (const e of events) {
        // #15: group/label by the resolved hierarchy path when available, falling
        // back to the flat job title — see hierarchy_label above. Two jobs that
        // share a task-type (e.g. a legacy job converted onto it, see #15
        // convert_legacy_job) collapse into one grouped session here.
        const job = hierarchy_label(e);
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
                state.pausePairs = 0;
                state.hasGlobal = false;
                state.hasWorkspace = false;
                note_source(state, e);
                break;
            }

            case "pause": {
                if (state.currentSession && !state.inPause && state.lastActiveStart != null) {
                    state.accumulatedMs += ts - state.lastActiveStart;
                    state.lastActiveStart = null;
                    state.inPause = true;
                    note_source(state, e);
                }
                break;
            }

            case "resume": {
                if (state.currentSession && state.inPause) {
                    state.inPause = false;
                    state.lastActiveStart = ts;
                    state.pausePairs += 1;
                    note_source(state, e);
                }
                break;
            }

            case "stop": {
                if (state.currentSession) {
                    note_source(state, e);
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
// STABLE PALETTE
// ---------------------------------------------------------------------

function assign_job_colors(allSessions) {
    // Validated categorical palette (dark surface #1e1e1e): passes lightness,
    // chroma, CVD-separation, normal-vision and contrast checks in this order.
    // Past 10 jobs the palette wraps — colour alone no longer identifies a job,
    // which is why the legend and table carry the names.
    const base = [
        "#3987e5", "#008300", "#d55181", "#c98500",
        "#199e70", "#d95926", "#9085e9", "#e66767",
        "#8a8a3a", "#b06a9e"
    ];
    // Alphabetical order → a job keeps the same colour across data reloads.
    all_jobs_sorted = [...new Set(allSessions.map(s => s.job))].sort((a, b) => a.localeCompare(b));
    job_color_map = {};
    all_jobs_sorted.forEach((job, i) => {
        job_color_map[job] = base[i % base.length];
    });
}

function color_for(job) {
    return job_color_map[job] || "#898781";
}

// Chart chrome tokens: read from the CSS custom properties so the stylesheet
// stays the single source of truth (literals are the no-CSS fallback).
function css_token(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}
const CHART_SURFACE = css_token("--surface", "#1e1e1e");
const CHART_INK_SECONDARY = css_token("--ink-secondary", "#c3c2b7");
const CHART_GRIDLINE = css_token("--gridline", "#2c2c2a");

/** Escape a string for interpolation into HTML text or attribute values. */
function escape_html(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------
// MAIN FILTER PIPELINE
// ---------------------------------------------------------------------

function apply_and_render() {
    let filtered = Filters.apply_filters(all_sessions, filter_state);
    filtered = Filters.sort_sessions(filtered, filter_state.sort_key, filter_state.sort_dir);

    render_pie_chart(filtered);
    render_stacked_bar_chart(filtered);
    render_session_table(filtered);
    render_empty_state(filtered);
    render_sort_indicators();
    // Legend hours track the date/range filters, so refresh it too
    render_job_legend();
}

// ---------------------------------------------------------------------
// DATE CONTROLS
// ---------------------------------------------------------------------

function render_date_controls() {
    const preset = document.getElementById("preset_range");
    if (preset) preset.value = filter_state.preset;
    set_date_inputs(filter_state.start_day, filter_state.end_day);
}

function set_date_inputs(start_day, end_day) {
    const start_el = document.getElementById("start_date");
    const end_el = document.getElementById("end_date");
    if (start_el) start_el.value = start_day || "";
    if (end_el) end_el.value = end_day || "";
}

// ---------------------------------------------------------------------
// JOB LEGEND + TABLE DROPDOWN (two synced surfaces, one selection)
// ---------------------------------------------------------------------

// Cached by load_payload — the job list only changes when the payload does.
let all_jobs_sorted = [];

function all_job_names() {
    return all_jobs_sorted;
}

/** Which jobs are currently selected (state.jobs === null means all). */
function selected_job_set() {
    if (filter_state.jobs === null) return new Set(all_job_names());
    return new Set(filter_state.jobs);
}

function render_filter_controls() {
    render_job_legend();
    render_job_dropdown();
    sync_range_inputs();
}

// The legend and the table dropdown are the same picker rendered into two
// surfaces; only ids/classes/decoration differ.
const JOB_PICKER_SURFACES = [
    {
        container_id: "job_legend",
        all_id: "job_all_checkbox",
        row_class: "legend-row",
        all_row_class: "legend-row legend-all",
        box_class: "legend-job-box",
        swatches: true,
    },
    {
        container_id: "job_dropdown_list",
        all_id: "job_dropdown_all",
        row_class: "dropdown-row",
        all_row_class: "dropdown-row",
        box_class: "dropdown-job-box",
        swatches: false,
    },
];

function job_picker_row(surface, job, checked, hours_label) {
    const swatch = surface.swatches
        ? (job === null
            ? `<span class="legend-swatch" style="visibility:hidden;"></span>`
            : `<span class="legend-swatch" style="background:${color_for(job)};"></span>`)
        : "";
    const input = job === null
        ? `<input type="checkbox" id="${surface.all_id}" ${checked ? "checked" : ""}>`
        : `<input type="checkbox" class="${surface.box_class}" value="${escape_html(job)}" ${checked ? "checked" : ""}>`;
    const text = job === null ? "All" : escape_html(job);
    // Tooltip carries the full name in case the row truncates it
    const tooltip = job === null ? "" : ` title="${escape_html(job)}"`;
    const hours = hours_label === undefined ? "" : `<span class="legend-hours">(${hours_label})</span>`;
    const row_class = job === null ? surface.all_row_class : surface.row_class;
    return `<label class="${row_class}">${input}${swatch}<span class="legend-text"${tooltip}>${text}</span>${hours}</label>`;
}

function render_job_picker(surface, totals) {
    const container = document.getElementById(surface.container_id);
    if (!container) return;
    const selected = selected_job_set();
    const jobs = all_job_names();
    const all_checked = jobs.every(j => selected.has(j));

    const hours_for = (job) => {
        if (!totals) return undefined;
        const ms = job === null
            ? Object.values(totals).reduce((a, b) => a + b, 0)
            : (totals[job] || 0);
        return (ms / 3600000).toFixed(1) + "h";
    };

    container.innerHTML =
        job_picker_row(surface, null, all_checked, hours_for(null)) +
        jobs.map(job => job_picker_row(surface, job, selected.has(job), hours_for(job))).join("");
}

/**
 * Per-job totals under the current date/duration/pause/source filters but
 * ignoring the job selection itself — so unchecking a job doesn't zero its
 * legend number, it keeps telling you what checking it would bring back.
 */
function job_totals_ignoring_job_filter() {
    const sessions = Filters.apply_filters(all_sessions, { ...filter_state, jobs: null });
    const totals = {};
    sessions.forEach(s => { totals[s.job] = (totals[s.job] || 0) + s.duration_ms; });
    return totals;
}

function render_job_legend() {
    render_job_picker(JOB_PICKER_SURFACES[0], job_totals_ignoring_job_filter());
}

function render_job_dropdown() {
    render_job_picker(JOB_PICKER_SURFACES[1]);
    render_filter_indicators();
}

/**
 * Light up each column's funnel when its filter is actively limiting data,
 * and carry the detail in the tooltip.
 */
function render_filter_indicators() {
    const jobs = all_job_names();
    const selected = selected_job_set();
    const job_active = filter_state.jobs !== null && selected.size < jobs.length;
    set_funnel_state("job_filter_toggle", job_active,
        job_active ? `Filtering: ${selected.size} of ${jobs.length} jobs` : "Filter by job");

    const dur_active = filter_state.duration_min_h !== null || filter_state.duration_max_h !== null;
    set_funnel_state("dur_filter_toggle", dur_active,
        dur_active ? "Duration filter active" : "Filter by duration");

    const pause_active = filter_state.pauses_min !== null || filter_state.pauses_max !== null;
    set_funnel_state("pause_filter_toggle", pause_active,
        pause_active ? "Pause filter active" : "Filter by pause count");
}

function set_funnel_state(id, active, tooltip) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("filter-active", active);
    el.title = tooltip;
}

function close_all_filter_menus() {
    document.querySelectorAll("details.col-filter[open]").forEach(d => { d.open = false; });
}

/**
 * Update the shared job selection from one surface, then re-render both.
 * A full set collapses to null so newly appearing jobs stay included.
 */
function set_job_selection(job_array) {
    const jobs = all_job_names();
    if (job_array.length === jobs.length) {
        filter_state.jobs = null;
    } else {
        filter_state.jobs = job_array;
    }
    render_job_legend();
    render_job_dropdown();
    apply_and_render();
}

// ---------------------------------------------------------------------
// RANGE INPUTS (duration / pauses)
// ---------------------------------------------------------------------

function sync_range_inputs() {
    set_number_input("dur_min", filter_state.duration_min_h);
    set_number_input("dur_max", filter_state.duration_max_h);
    set_number_input("pause_min", filter_state.pauses_min);
    set_number_input("pause_max", filter_state.pauses_max);
}

function set_number_input(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value === null || value === undefined ? "" : String(value);
}

function read_number_input(id) {
    const el = document.getElementById(id);
    if (!el || el.value.trim() === "") return null;
    const n = Number(el.value);
    return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------
// FILTER LISTENERS
// ---------------------------------------------------------------------

function attach_filter_listeners() {
    bind_once(document.getElementById("preset_range"), "change", on_preset_change);
    bind_once(document.getElementById("start_date"), "change", on_date_input_change);
    bind_once(document.getElementById("end_date"), "change", on_date_input_change);
    bind_once(document.getElementById("clear_filters_btn"), "click", clear_filters);

    // Range filters commit on Enter or on leaving the field (native "change"),
    // never per keystroke — typing "0.5" must not transiently filter on "0".
    // Enter also closes the menu.
    ["dur_min", "dur_max", "pause_min", "pause_max"].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.bound) {
            el.addEventListener("change", on_range_change);
            el.addEventListener("keydown", (ev) => {
                if (ev.key === "Enter") {
                    ev.preventDefault();
                    on_range_change();
                    close_all_filter_menus();
                }
            });
            el.dataset.bound = "true";
        }
    });

    // Job legend + dropdown use event delegation so they survive re-renders.
    JOB_PICKER_SURFACES.forEach(surface => {
        bind_once(document.getElementById(surface.container_id), "change",
            (ev) => on_job_picker_change(surface, ev));
    });

    // Session table: delegated Edit-button handler survives row rebuilds.
    bind_once(document.getElementById("session_table_body"), "click", (ev) => {
        const btn = ev.target.closest("button.session-edit-btn");
        if (!btn) return;
        open_session_edit_modal({
            job: btn.dataset.job,
            start: Number(btn.dataset.start),
            stop: Number(btn.dataset.stop),
        });
    });

    // Per-column Clear buttons: remove just that column's filter, close the menu
    bind_once(document.getElementById("job_filter_clear"), "click", () => {
        set_job_selection(all_job_names().slice());
        close_all_filter_menus();
    });
    bind_once(document.getElementById("dur_filter_clear"), "click", () => {
        set_number_input("dur_min", null);
        set_number_input("dur_max", null);
        on_range_change();
        close_all_filter_menus();
    });
    bind_once(document.getElementById("pause_filter_clear"), "click", () => {
        set_number_input("pause_min", null);
        set_number_input("pause_max", null);
        on_range_change();
        close_all_filter_menus();
    });

    // Sortable headers — clicks inside a funnel menu must not change the sort
    document.querySelectorAll("#session_table th.sortable").forEach(th => {
        bind_once(th, "click", (ev) => {
            if (ev.target.closest("details.col-filter")) return;
            on_sort_click(th.dataset.sort);
        });
    });

    // Column filter menus: one open at a time
    document.querySelectorAll("details.col-filter").forEach(d => {
        bind_once(d, "toggle", () => {
            if (d.open) {
                document.querySelectorAll("details.col-filter[open]").forEach(other => {
                    if (other !== d) other.open = false;
                });
            }
        });
    });

    // Document-level bindings (guarded — attach_filter_listeners can re-run)
    if (!document_listeners_bound) {
        document_listeners_bound = true;

        // Click outside any open funnel menu closes it
        document.addEventListener("click", (ev) => {
            if (!ev.target.closest("details.col-filter")) close_all_filter_menus();
        });

        // Keyboard: in the edit modal Enter saves / Escape cancels;
        // elsewhere Escape closes any open funnel menu
        document.addEventListener("keydown", (ev) => {
            const modal = document.getElementById("session_edit_modal");
            const modal_open = modal && modal.style.display !== "none";
            if (modal_open) {
                if (ev.key === "Enter") {
                    ev.preventDefault();
                    const save = document.getElementById("session_edit_save");
                    if (save && !save.disabled) save.click();
                } else if (ev.key === "Escape") {
                    ev.preventDefault();
                    close_session_modal();
                }
                return;
            }
            if (ev.key === "Escape") close_all_filter_menus();
        });
    }
}

let document_listeners_bound = false;

function bind_once(el, evt, handler) {
    if (el && !el.dataset.bound) {
        el.addEventListener(evt, handler);
        el.dataset.bound = "true";
    }
}

function on_preset_change() {
    const preset = document.getElementById("preset_range").value;
    filter_state.preset = preset;
    if (preset !== "custom") {
        const range = Filters.resolve_preset_range(preset, new Date());
        filter_state.start_day = range.start_day;
        filter_state.end_day = range.end_day;
        set_date_inputs(range.start_day, range.end_day);
    }
    apply_and_render();
}

function on_date_input_change() {
    let start = document.getElementById("start_date").value || null;
    let end = document.getElementById("end_date").value || null;

    // Single-day rule: if the other field is empty, mirror the entered date.
    if (start && !end) end = start;
    else if (end && !start) start = end;

    filter_state.start_day = start;
    filter_state.end_day = end;
    set_date_inputs(start, end);

    // A manual date edit means the range is no longer a named preset.
    filter_state.preset = "custom";
    const preset = document.getElementById("preset_range");
    if (preset) preset.value = "custom";

    apply_and_render();
}

function on_range_change() {
    filter_state.duration_min_h = read_number_input("dur_min");
    filter_state.duration_max_h = read_number_input("dur_max");
    filter_state.pauses_min = read_number_input("pause_min");
    filter_state.pauses_max = read_number_input("pause_max");
    render_filter_indicators();
    apply_and_render();
}

function on_job_picker_change(surface, ev) {
    const target = ev.target;
    if (target.id === surface.all_id) {
        set_job_selection(target.checked ? all_job_names().slice() : []);
        return;
    }
    if (target.classList.contains(surface.box_class)) {
        set_job_selection(read_checked_values(`#${surface.container_id} .${surface.box_class}`));
    }
}

function read_checked_values(selector) {
    return [...document.querySelectorAll(selector)].filter(b => b.checked).map(b => b.value);
}

function on_sort_click(sort_key) {
    if (!sort_key) return;
    if (filter_state.sort_key === sort_key) {
        filter_state.sort_dir = filter_state.sort_dir === "asc" ? "desc" : "asc";
    } else {
        filter_state.sort_key = sort_key;
        filter_state.sort_dir = "desc";
    }
    apply_and_render();
}

// ---------------------------------------------------------------------
// CLEAR / RESET FILTERS
// ---------------------------------------------------------------------

function clear_filters() {
    filter_state = Filters.create_default_filter_state(new Date());
    render_date_controls();
    render_filter_controls();
    apply_and_render();
}

// ---------------------------------------------------------------------
// SORT INDICATORS
// ---------------------------------------------------------------------

function render_sort_indicators() {
    document.querySelectorAll("#session_table th.sortable").forEach(th => {
        th.classList.remove("sort-asc", "sort-desc");
        if (th.dataset.sort === filter_state.sort_key) {
            th.classList.add(filter_state.sort_dir === "asc" ? "sort-asc" : "sort-desc");
        }
    });
}

// ---------------------------------------------------------------------
// EMPTY STATE
// ---------------------------------------------------------------------

function render_empty_state(sessions) {
    const empty = sessions.length === 0;
    const el = document.getElementById("empty_state");
    if (el) el.style.display = empty ? "" : "none";
    // Prominent message in place of the pie chart — the likeliest cause is a
    // too-narrow date range, so point the user there
    const pie_msg = document.getElementById("pie_empty");
    if (pie_msg) pie_msg.style.display = empty ? "" : "none";
    const pie_canvas = document.getElementById("pie_chart");
    if (pie_canvas) pie_canvas.style.display = empty ? "none" : "";
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

    const total_hours = hours.reduce((a, b) => a + b, 0);

    pie_chart_instance = new Chart(ctx, {
        type: "pie",
        data: {
            labels: jobs,
            datasets: [{
                data: hours,
                backgroundColor: jobs.map(j => color_for(j)),
                // 2px surface gap between slices
                borderColor: CHART_SURFACE,
                borderWidth: 2
            }]
        },
        options: {
            plugins: {
                legend: { display: false },
                datalabels: {
                    // Selective labels: skip slices under 5% — they'd collide
                    formatter: (value) =>
                        total_hours > 0 && value / total_hours < 0.05 ? "" : value.toFixed(1) + "h",
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
        const day = Filters.get_local_day(s.start);
        map[day] = map[day] || {};
        map[day][s.job] = (map[day][s.job] || 0) + s.duration_ms;
    });

    const days = Object.keys(map).sort((a, b) => new Date(a) - new Date(b));
    const jobs = [...new Set(sessions.map(s => s.job))].sort((a, b) => a.localeCompare(b));

    const datasets = jobs.map(job => ({
        label: job,
        data: days.map(d => (map[d][job] || 0) / 3600000),
        backgroundColor: color_for(job),
        // 2px surface gap between stacked segments and adjacent bars
        borderColor: CHART_SURFACE,
        borderWidth: 2,
        borderSkipped: false
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
                x: {
                    stacked: true,
                    grid: { display: false },
                    ticks: { color: CHART_INK_SECONDARY }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    suggestedMax: padded_max,
                    grid: { color: CHART_GRIDLINE },
                    border: { color: CHART_GRIDLINE },
                    ticks: { color: CHART_INK_SECONDARY }
                }
            },
            plugins: {
                legend: { display: false },
                datalabels: {
                    color: "#fff",
                    font: { weight: "bold" },
                    clip: false,
                    offset: 4,
                    formatter: (value, ctx) => {
                        // The last dataset carries the per-day total, even when
                        // its own segment is empty that day
                        const last = ctx.chart.data.datasets.length - 1;
                        if (ctx.datasetIndex === last) {
                            const total = totals_per_day[ctx.dataIndex];
                            return total > 0 ? total.toFixed(1) + "h" : "";
                        }
                        // Selective labels: segments under 30 min are too short
                        // for legible text — the tooltip still carries the value
                        return !value || value < 0.5 ? "" : value.toFixed(1) + "h";
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
    const warningBox = document.getElementById('session_warning');
    if (warningBox) { warningBox.style.display = 'none'; warningBox.textContent = ''; }

    container.innerHTML = '';

    // Find events for this session (inclusive). Match on the same hierarchy label
    // used to group the session (not the flat job title) — a #15 grouped session
    // can span events whose flat job titles differ (e.g. a legacy alias) but share
    // a task-type.
    const events = all_events.filter(e => hierarchy_label(e) === session.job && e.timestamp >= session.start && e.timestamp <= session.stop).sort((a,b)=>a.timestamp - b.timestamp);

    events.forEach((e, idx) => {
        const key = `${e.event}|${e.job}|${e.timestamp}|${e.task || ''}`;
        const occurrences = eventOccurrencesMap.get(key) || [];

        const row = document.createElement('div');
        row.className = 'session-event-row';
        row.innerHTML = `
            <div class="e-label">${e.event}</div>
            <div class="e-ts"><input type="datetime-local" data-idx="${idx}"></div>
            <div class="e-task"><input type="text" data-idx="${idx}" value="${escape_html(e.event === 'stop' ? (e.task || '') : '')}"></div>
        `;

        // store metadata on row for save
        row._meta = { key, e, occurrences };

        // set timestamp input value
        const dtInput = row.querySelector('input[type="datetime-local"]');
        const dt = new Date(e.timestamp);
        // include seconds in the datetime-local input so edits can preserve seconds
        dtInput.value = new Date(dt.getTime() - (dt.getTimezoneOffset() * 60000)).toISOString().slice(0,19);

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
                // Build a complete EventDTO-compatible record for the backend
                const newRec = {
                    id: e.id,
                    event: e.event,
                    job_title: e.job,
                    timestamp: newTs,
                    job_id: e.job_id,
                    time_seed: e.time_seed
                };
                if (e.event === 'stop') newRec.task = taskInput.value || '';

                // Compare down to the second to avoid accidental minute-rounding edits
                const newTsSec = Math.floor(newTs / 1000);
                const oldTsSec = Math.floor(e.timestamp / 1000);

                // Only push if changed (seconds differ) or stop-task changed
                if (newTsSec !== oldTsSec || (e.event === 'stop' && (newRec.task || '') !== (e.task || ''))) {
                    edits.push({ id: e.id, new_record: newRec });
                }
            }

            if (edits.length === 0) { close_session_modal(); return; }

            // UI: disable save and show progress
            save.disabled = true;
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

    // Clear any previous highlights
    clear_session_highlights();

    sessions.forEach(s => {
        const tr = document.createElement("tr");

        const day = Filters.get_local_day(s.start);

        const start_local = new Date(s.start).toLocaleString();
        const stop_local = new Date(s.stop).toLocaleString();

        const editBtn = `<button class="session-edit-btn" data-job="${escape_html(s.job)}" data-start="${s.start}" data-stop="${s.stop}">Edit</button>`;

        tr.dataset.job = s.job;
        tr.dataset.day = day;

        tr.innerHTML =
            `<td>${day}</td>` +
            `<td>${escape_html(s.job)}</td>` +
            `<td>${(s.duration_ms / 3600000).toFixed(2)}h</td>` +
            `<td>${escape_html(s.task || "")}</td>` +
            `<td>${escape_html(start_local)}</td>` +
            `<td>${escape_html(stop_local)}</td>` +
            `<td>${s.pause_pairs}</td>` +
            `<td>${editBtn}</td>`;

        body.appendChild(tr);
    });
    // Edit clicks are handled by the delegated listener on #session_table_body
}

// ---------------------------------------------------------------------
// UTILITIES
// ---------------------------------------------------------------------

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
