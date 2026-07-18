import * as fs from "fs";
import * as crypto from "crypto";
import { write_file_atomic } from "../utils/fs_utils";

export const REPO_CONFIG_FORMAT_VERSION = 1;

/**
 * The committed `.timescope/config.json`: a repo's authority about itself.
 * In #48 it carries only a stable repo id; Client/Project binding + pinned
 * task-types are added in #15.
 */
export interface RepoConfig {
    repo_id: string;
    format_version: number;
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
    return { repo_id: rec.repo_id, format_version };
}

/** Write `.timescope/config.json` atomically, with repo_id first for readability. */
export function write_repo_config(config_path: string, config: RepoConfig): void {
    const body = { repo_id: config.repo_id, format_version: config.format_version };
    write_file_atomic(config_path, JSON.stringify(body, null, 2) + "\n");
}
