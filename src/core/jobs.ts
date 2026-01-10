import * as fs from "fs";
import * as path from "path";
import { TimeScopePaths } from "./paths";
import { rename_job_in_log_file } from "./logs";

function ensure_dir_exists(file_path: string) {
    const dir = path.dirname(file_path);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function load_jobs_from_file(file_path: string): string[] {
    if (!fs.existsSync(file_path)) return [];
    try {
        const raw = fs.readFileSync(file_path, "utf8");
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function save_jobs_to_file(file_path: string, jobs: string[]) {
    ensure_dir_exists(file_path);
    fs.writeFileSync(file_path, JSON.stringify(jobs, null, 2), "utf8");
}

//
// PUBLIC API
//

/**
 * Load the global jobs file and return the list of job names (sorted).
 */
export function load_all_jobs(paths: TimeScopePaths): string[] {
    // GLOBAL ONLY
    const global_jobs = load_jobs_from_file(paths.global_jobs_path);
    return global_jobs.sort((a, b) => a.localeCompare(b));
}

/**
 * Add a job to the global jobs list if it does not already exist.
 */
export function add_job(paths: TimeScopePaths, job_name: string): void {
    // GLOBAL ONLY
    const jobs = load_jobs_from_file(paths.global_jobs_path);

    if (!jobs.includes(job_name)) {
        jobs.push(job_name);
        jobs.sort((a, b) => a.localeCompare(b));
        save_jobs_to_file(paths.global_jobs_path, jobs);
    }
}

/**
 * Rename a job in the global jobs file and update all logs where the job
 * is referenced (both global canonical and workspace mirror).
 */
export function rename_job(paths: TimeScopePaths, old_name: string, new_name: string): void {
    // GLOBAL JOBS ONLY
    const jobs = load_jobs_from_file(paths.global_jobs_path);

    const idx = jobs.indexOf(old_name);
    if (idx === -1) return;

    jobs[idx] = new_name;
    jobs.sort((a, b) => a.localeCompare(b));

    save_jobs_to_file(paths.global_jobs_path, jobs);

    // Update both global + workspace logs
    rename_job_in_log_file(paths, old_name, new_name);
}

/**
 * Remove a job from the global jobs list.
 */
export function delete_job(paths: TimeScopePaths, job_name: string): void {
    // GLOBAL ONLY
    const jobs = load_jobs_from_file(paths.global_jobs_path);

    const filtered = jobs.filter(j => j !== job_name);
    save_jobs_to_file(paths.global_jobs_path, filtered);
}