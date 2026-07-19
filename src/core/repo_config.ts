import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { write_file_atomic, ensure_dir_sync } from "../utils/fs_utils";

export const REPO_CONFIG_FORMAT_VERSION = 2;

/** A repo's cached job (US-06): id + current display title. Travels with the repo. */
export interface RepoConfigJob {
    job_id: string;
    job_title: string;
}

/**
 * The committed `.timescope/config.json`: a repo's authority about itself.
 * Carries a stable repo id and (US-06) a cache of the repo's jobs so a fresh
 * clone can populate the Start picker without a global job list. Client/Project
 * binding + pinned task-types are added in #15.
 */
export interface RepoConfig {
    repo_id: string;
    format_version: number;
    jobs?: RepoConfigJob[];
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

    return { repo_id: rec.repo_id, format_version, jobs };
}

/**
 * Attempt to create `.timescope/config.json` exclusively (fails if it already exists).
 * Returns true when this call won the race and created the file; false when another
 * writer got there first — the caller should then re-read and adopt the winner's id.
 * Deliberately NOT `write_file_atomic` (temp+rename would silently clobber the winner).
 *
 * Uses temp-file + `fs.linkSync` (not a plain `wx`-flagged write): the temp file's
 * content is written in full *before* the exclusive link is attempted, so a loser who
 * loses the race can never observe (and throw on) a partially-written config — the link
 * either doesn't happen at all (EEXIST) or happens against fully-formed content (#47 F4).
 */
export function try_create_repo_config(config_path: string, config: RepoConfig): boolean {
    const body: { repo_id: string; format_version: number; jobs?: RepoConfigJob[] } = {
        repo_id: config.repo_id,
        format_version: config.format_version,
    };
    if (config.jobs) body.jobs = config.jobs.map(j => ({ job_id: j.job_id, job_title: j.job_title }));
    ensure_dir_sync(config_path);
    const dir = path.dirname(config_path);
    const tmp = path.join(dir, `.${path.basename(config_path)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n", "utf8");
    try {
        fs.linkSync(tmp, config_path);
        return true;
    } catch (ex) {
        if ((ex as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw ex;
    } finally {
        try { fs.unlinkSync(tmp); } catch { /* best effort cleanup */ }
    }
}

/** Write `.timescope/config.json` atomically, with repo_id first for readability. */
export function write_repo_config(config_path: string, config: RepoConfig): void {
    const body: { repo_id: string; format_version: number; jobs?: RepoConfigJob[] } = {
        repo_id: config.repo_id,
        format_version: config.format_version,
    };
    if (config.jobs) body.jobs = config.jobs.map(j => ({ job_id: j.job_id, job_title: j.job_title }));
    write_file_atomic(config_path, JSON.stringify(body, null, 2) + "\n");
}
