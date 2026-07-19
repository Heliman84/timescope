import * as fs from "fs";
import * as crypto from "crypto";
import { write_file_atomic } from "../utils/fs_utils";

export const REPO_CONFIG_FORMAT_VERSION = 2;

/** A repo's cached job (US-06): id + current display title. Travels with the repo. */
export interface RepoConfigJob {
    job_id: string;
    job_title: string;
}

/**
 * A repo's binding to a Client/Project (#15). Strict binding: sessions in a bound repo
 * belong to this Client/Project implicitly — Client/Project ids are never stored on
 * events, only referenced here in the repo's own committed config.
 */
export interface RepoConfigBinding {
    client_id: string;
    project_id: string;
}

/**
 * The committed `.timescope/config.json`: a repo's authority about itself.
 * Carries a stable repo id and (US-06) a cache of the repo's jobs so a fresh
 * clone can populate the Start picker without a global job list. #15 adds an
 * optional Client/Project `binding` and an ordered `pinned_task_types` list
 * (this repo's preferred task-type vocabulary, surfaced first in the picker).
 */
export interface RepoConfig {
    repo_id: string;
    format_version: number;
    jobs?: RepoConfigJob[];
    binding?: RepoConfigBinding;
    pinned_task_types?: string[];
}

/** Stable, random 12-char hex repo id, generated once at opt-in and committed. */
export function generate_repo_id(): string {
    return crypto.randomBytes(6).toString("hex");
}

/**
 * Read `.timescope/config.json`. Returns null when the file is absent (folder
 * not opted in). Throws on malformed JSON or a missing repo_id so we never
 * silently mint a new identity over a damaged config.
 */
export function read_repo_config(config_path: string): RepoConfig | null {
    if (!fs.existsSync(config_path)) return null;
    const raw = fs.readFileSync(config_path, "utf8");
    let obj: unknown;
    try {
        obj = JSON.parse(raw);
    } catch (ex) {
        throw new Error(`Malformed repo config at '${config_path}': ${String(ex)}`);
    }
    const rec = obj as Record<string, unknown>;
    if (!rec || typeof rec.repo_id !== "string" || rec.repo_id.length === 0) {
        throw new Error(`Invalid repo config at '${config_path}': missing repo_id`);
    }
    const format_version = typeof rec.format_version === "number" ? rec.format_version : REPO_CONFIG_FORMAT_VERSION;

    // Cached jobs (US-06) — present in v2+ configs; tolerated-absent for older ones.
    let jobs: RepoConfigJob[] | undefined;
    if (Array.isArray(rec.jobs)) {
        jobs = [];
        for (const item of rec.jobs) {
            const j = item as Record<string, unknown>;
            if (j && typeof j.job_id === "string" && j.job_id.length > 0
                && typeof j.job_title === "string" && j.job_title.length > 0) {
                jobs.push({ job_id: j.job_id, job_title: j.job_title });
            }
        }
    }

    // Client/Project binding (#15) — additive; a malformed/partial binding is dropped
    // rather than trusted, same tolerant style as the jobs cache above.
    let binding: RepoConfigBinding | undefined;
    if (rec.binding && typeof rec.binding === "object") {
        const b = rec.binding as Record<string, unknown>;
        if (typeof b.client_id === "string" && b.client_id.length > 0
            && typeof b.project_id === "string" && b.project_id.length > 0) {
            binding = { client_id: b.client_id, project_id: b.project_id };
        }
    }

    // Pinned task-types (#15) — additive; non-string entries are filtered out.
    let pinned_task_types: string[] | undefined;
    if (Array.isArray(rec.pinned_task_types)) {
        pinned_task_types = rec.pinned_task_types.filter((t): t is string => typeof t === "string");
    }

    return { repo_id: rec.repo_id, format_version, jobs, binding, pinned_task_types };
}

/** Write `.timescope/config.json` atomically, with repo_id first for readability. */
export function write_repo_config(config_path: string, config: RepoConfig): void {
    const body: {
        repo_id: string;
        format_version: number;
        jobs?: RepoConfigJob[];
        binding?: RepoConfigBinding;
        pinned_task_types?: string[];
    } = {
        repo_id: config.repo_id,
        format_version: config.format_version,
    };
    if (config.jobs) body.jobs = config.jobs.map(j => ({ job_id: j.job_id, job_title: j.job_title }));
    if (config.binding) body.binding = { client_id: config.binding.client_id, project_id: config.binding.project_id };
    if (config.pinned_task_types) body.pinned_task_types = config.pinned_task_types.slice();
    write_file_atomic(config_path, JSON.stringify(body, null, 2) + "\n");
}
