import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import {
    generate_repo_id,
    read_repo_config,
    write_repo_config,
    REPO_CONFIG_FORMAT_VERSION,
} from "../core/repo_config";

function mkdir_tmp(suffix: string): string {
    const root = path.join(__dirname, "..", "..", "test-output", `repo-config-${suffix}-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
    return root;
}

/**
 * Tests repo_config:
 * - Target: generate_repo_id / read_repo_config / write_repo_config in src/core/repo_config.ts
 * - What: stable random repo ids, round-trip of .timescope/config.json, tolerant/strict reads.
 * - Why: config.json is the committed authority that binds a repo to its own identity (#48).
 */
export function run_repo_config_tests(): void {
    // Generated ids are well-formed and unique across calls.
    const a = generate_repo_id();
    const b = generate_repo_id();
    assert.ok(/^[0-9a-f]{12}$/.test(a), `repo id should be 12 hex chars, got '${a}'`);
    assert.notStrictEqual(a, b, "two generated repo ids should differ");

    // Missing file → null (folder not opted in / no config yet).
    const root = mkdir_tmp("roundtrip");
    const cfg_path = path.join(root, "config.json");
    assert.strictEqual(read_repo_config(cfg_path), null, "missing config reads as null");

    // Round-trip: write then read yields the same repo_id + format version.
    write_repo_config(cfg_path, { repo_id: a, format_version: REPO_CONFIG_FORMAT_VERSION });
    const loaded = read_repo_config(cfg_path);
    assert.ok(loaded, "written config should read back");
    assert.strictEqual(loaded!.repo_id, a, "repo_id round-trips");
    assert.strictEqual(loaded!.format_version, REPO_CONFIG_FORMAT_VERSION, "format_version round-trips");

    // Absent format_version defaults rather than failing.
    fs.writeFileSync(cfg_path, JSON.stringify({ repo_id: b }) + "\n", "utf8");
    const noVer = read_repo_config(cfg_path);
    assert.strictEqual(noVer!.repo_id, b, "repo_id read without a format_version");
    assert.strictEqual(noVer!.format_version, REPO_CONFIG_FORMAT_VERSION, "missing format_version defaults");

    // Malformed / missing repo_id → throw, so we never silently mint a new identity.
    fs.writeFileSync(cfg_path, "{ not json", "utf8");
    assert.throws(() => read_repo_config(cfg_path), /Malformed repo config/, "malformed JSON throws");
    fs.writeFileSync(cfg_path, JSON.stringify({ format_version: 1 }) + "\n", "utf8");
    assert.throws(() => read_repo_config(cfg_path), /Invalid repo config/, "missing repo_id throws");
}
