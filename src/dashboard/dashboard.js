
const vscode = acquireVsCodeApi();
//
// REQUEST INITIAL DATA
//
vscode.postMessage({ type: "request_data" });

let all_sessions = [];
let pie_chart_instance = null;
let stacked_chart_instance = null;
let hasRenderedJobFilter = false;

//
// MESSAGE HANDLER — FIRST RENDER
//
window.addEventListener("message", (event) => {
    const msg = event.data;

    if (msg.type === "summary_data") {
        all_sessions = msg.payload;
        render_dashboard(all_sessions);   // FIRST render uses raw data
        attach_filter_listeners();        // THEN attach listeners
    }
});

//
// FILTER LISTENERS
//
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

    document.querySelectorAll("#job_filter_container input[type=checkbox]").forEach(box => {
        if (!box.dataset.bound) {
            box.addEventListener("change", apply_filters_and_render);
            box.dataset.bound = "true";
        }
    });
}

//
// MAIN FILTER PIPELINE
//
function apply_filters_and_render() {
    const filtered = filter_sessions(all_sessions);
    render_dashboard(filtered);
}

//
// DATE + JOB FILTERING
//
function filter_sessions(sessions) {
    const preset = document.getElementById("preset_range").value;

    const now = new Date();
    const today_local = get_local_day(now);

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
        start_date = get_local_day(monday);
        end_date = today_local;
    }

    if (preset === "last_7") {
        const d = new Date(now);
        d.setDate(now.getDate() - 6);
        start_date = get_local_day(d);
        end_date = today_local;
    }

    if (preset === "this_month") {
        const first = new Date(now.getFullYear(), now.getMonth(), 1);
        start_date = get_local_day(first);
        end_date = today_local;
    }

    if (preset === "last_3_months") {
        const d = new Date(now);
        d.setMonth(now.getMonth() - 2);
        const first = new Date(d.getFullYear(), d.getMonth(), 1);
        start_date = get_local_day(first);
        end_date = today_local;
    }

    let date_filtered = sessions;

    if (start_date && end_date) {
        date_filtered = sessions.filter(s => {
            const day = get_local_day(s.start);
            return day >= start_date && day <= end_date;
        });
    }

    // JOB FILTERING
    const selected_jobs = [...document.querySelectorAll("#job_filter_container input[type=checkbox]:checked")]
        .map(b => b.value);

    return date_filtered.filter(s => selected_jobs.includes(s.job));
}

//
// DASHBOARD RENDERER
//
function render_dashboard(sessions) {
    render_job_filter(all_sessions);
    attach_filter_listeners();
    render_pie_chart(sessions);
    render_stacked_bar_chart(sessions);
    render_session_table(sessions);
}

//
// JOB FILTER CHECKBOXES
//
function render_job_filter(allSessions) {
    const container = document.getElementById("job_filter_container");

    // Capture previous selections (only meaningful after first render)
    const previouslyChecked = new Set(
        [...document.querySelectorAll("#job_filter_container input[type=checkbox]")]
            .filter(b => b.checked)
            .map(b => b.value)
    );

    container.innerHTML = "";

    const jobs = [...new Set(allSessions.map(s => s.job))];

    jobs.forEach(job => {
        const div = document.createElement("div");

        let checked;

        if (!hasRenderedJobFilter) {
            // First render → all checked
            checked = true;
        } else {
            // Subsequent renders → preserve user selections
            checked = previouslyChecked.has(job);
        }

        div.innerHTML =
            '<label><input type="checkbox" ' +
            (checked ? "checked" : "") +
            ' value="' + job + '"> ' +
            job +
            '</label>';

        container.appendChild(div);
    });

    // Mark that we've completed the first render
    hasRenderedJobFilter = true;
}

function clear_filters() {
    // Reset date preset to default (you can change this)
    const preset = document.getElementById("preset_range");
    if (preset) {
        preset.value = "this_month"; // or "all_time" or whatever your default is
    }

    // Re-check all jobs
    document.querySelectorAll("#job_filter_container input[type=checkbox]").forEach(box => {
        box.checked = true;
    });

    // Re-render dashboard with full dataset
    apply_filters_and_render();
}

//
// PIE CHART
//
function render_pie_chart(sessions) {
    const ctx = document.getElementById("pie_chart");

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

//
// STACKED BAR CHART
//
function render_stacked_bar_chart(sessions) {
    const ctx = document.getElementById("stacked_bar_chart");

    const map = {};
    sessions.forEach(s => {
        const day = get_local_day(s.start);
        map[day] = map[day] || {};
        map[day][s.job] = (map[day][s.job] || 0) + s.duration_ms;
    });

    const days = Object.keys(map).sort((a, b) => new Date(a) - new Date(b));
    const jobs = [...new Set(sessions.map(s => s.job))];

    const datasets = jobs.map((job, idx) => ({
        label: job,
        data: days.map(d => (map[d][job] || 0) / 3600000),
        backgroundColor: generate_color_palette(jobs.length)[idx]
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

//
// RAW SESSION TABLE
//
function render_session_table(sessions) {
    const body = document.getElementById("session_table_body");
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

//
// UTILITIES
//
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

