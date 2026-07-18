/**
 * Pure filter/sort logic for the summary dashboard.
 *
 * Vanilla JS on purpose: the webview loads it as a plain <script> (global
 * `TimeScopeFilters`), and the pure-Node test suite require()s the same file.
 * No DOM access, no Chart.js — dashboard.js owns all rendering.
 *
 * The filter state is one plain object; `start_day`/`end_day` are always the
 * authoritative date bounds (presets resolve into them), `jobs === null`
 * means "all jobs", and `source` is the issue #3 local/global seam.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.TimeScopeFilters = factory();
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // Tolerance for hour-entered bounds: 0.1h * 3600000 is not exact in
    // IEEE754, and the ranges are inclusive by spec.
    const HOURS_EPSILON = 1e-9;

    function get_local_day(timestamp) {
        const d = new Date(timestamp);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function resolve_preset_range(preset, now) {
        const today = get_local_day(now.getTime());

        switch (preset) {
            case "today":
                return { start_day: today, end_day: today };
            case "this_week": {
                const monday = new Date(now);
                monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
                return { start_day: get_local_day(monday.getTime()), end_day: today };
            }
            case "last_7": {
                const d = new Date(now);
                d.setDate(now.getDate() - 6);
                return { start_day: get_local_day(d.getTime()), end_day: today };
            }
            case "last_14": {
                const d = new Date(now);
                d.setDate(now.getDate() - 13);
                return { start_day: get_local_day(d.getTime()), end_day: today };
            }
            case "last_4_weeks": {
                const d = new Date(now);
                d.setDate(now.getDate() - 27);
                return { start_day: get_local_day(d.getTime()), end_day: today };
            }
            case "this_month": {
                const first = new Date(now.getFullYear(), now.getMonth(), 1);
                return { start_day: get_local_day(first.getTime()), end_day: today };
            }
            case "last_3_months": {
                const first = new Date(now.getFullYear(), now.getMonth() - 2, 1);
                return { start_day: get_local_day(first.getTime()), end_day: today };
            }
            case "last_year": {
                const first = new Date(now.getFullYear(), now.getMonth() - 11, 1);
                return { start_day: get_local_day(first.getTime()), end_day: today };
            }
            case "all":
            case "custom":
            default:
                return { start_day: null, end_day: null };
        }
    }

    function create_default_filter_state(now) {
        const range = resolve_preset_range("last_4_weeks", now);
        return {
            preset: "last_4_weeks",
            start_day: range.start_day,
            end_day: range.end_day,
            jobs: null,
            duration_min_h: null,
            duration_max_h: null,
            pauses_min: null,
            pauses_max: null,
            source: "merged",
            sort_key: "start",
            sort_dir: "desc",
        };
    }

    function session_passes(session, state) {
        const day = get_local_day(session.start);
        if (state.start_day !== null && day < state.start_day) return false;
        if (state.end_day !== null && day > state.end_day) return false;

        if (state.jobs !== null && state.jobs.indexOf(session.job) === -1) return false;

        const duration_h = session.duration_ms / 3600000;
        if (state.duration_min_h !== null && duration_h < state.duration_min_h - HOURS_EPSILON) return false;
        if (state.duration_max_h !== null && duration_h > state.duration_max_h + HOURS_EPSILON) return false;

        if (state.pauses_min !== null && session.pause_pairs < state.pauses_min) return false;
        if (state.pauses_max !== null && session.pause_pairs > state.pauses_max) return false;

        // Source filter (issue #3 seam). Post local-first cutover (#48 48c) the
        // dashboard reads the derived index, whose events carry no global/workspace
        // line index, so sessions come through unclassified — treat those as present
        // in the merged view so the filter is inert rather than hiding everything.
        // #3 redefines "source" as per-repo and reintroduces real classification.
        const classified = session.has_global || session.has_workspace;
        if (classified) {
            if (state.source === "global" && !session.has_global) return false;
            if (state.source === "workspace" && !session.has_workspace) return false;
        }

        return true;
    }

    function apply_filters(sessions, state) {
        return sessions.filter((s) => session_passes(s, state));
    }

    const SORT_ACCESSORS = {
        date: (s) => s.start,
        start: (s) => s.start,
        stop: (s) => s.stop,
        duration: (s) => s.duration_ms,
        pauses: (s) => s.pause_pairs,
        job: (s) => s.job.toLowerCase(),
    };

    function sort_sessions(sessions, sort_key, sort_dir) {
        const accessor = SORT_ACCESSORS[sort_key] || SORT_ACCESSORS.start;
        const sign = sort_dir === "asc" ? 1 : -1;
        return sessions.slice().sort((a, b) => {
            const va = accessor(a);
            const vb = accessor(b);
            if (va < vb) return -1 * sign;
            if (va > vb) return 1 * sign;
            return 0;
        });
    }

    return {
        create_default_filter_state,
        resolve_preset_range,
        apply_filters,
        sort_sessions,
        get_local_day,
    };
});
