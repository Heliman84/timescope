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

    // Cached jobs (US-06) round-trip; malformed entries are dropped.
    write_repo_config(cfg_path, {
        repo_id: a, format_version: REPO_CONFIG_FORMAT_VERSION,
        jobs: [{ job_id: "16lor", job_title: "test-issue9" }],
    });
    const withJobs = read_repo_config(cfg_path)!;
    assert.strictEqual(withJobs.jobs!.length, 1, "cached jobs round-trip");
    assert.strictEqual(withJobs.jobs![0].job_title, "test-issue9", "cached job title round-trips");
    fs.writeFileSync(cfg_path, JSON.stringify({ repo_id: a, jobs: [{ job_id: "x" }, { job_id: "y", job_title: "ok" }] }) + "\n", "utf8");
    assert.strictEqual(read_repo_config(cfg_path)!.jobs!.length, 1, "job entries missing a title are dropped");

    // Malformed / missing repo_id → throw, so we never silently mint a new identity.
    fs.writeFileSync(cfg_path, "{ not json", "utf8");
    assert.throws(() => read_repo_config(cfg_path), /Malformed repo config/, "malformed JSON throws");
    fs.writeFileSync(cfg_path, JSON.stringify({ format_version: 1 }) + "\n", "utf8");
    assert.throws(() => read_repo_config(cfg_path), /Invalid repo config/, "missing repo_id throws");
}

/**
 * Tests the #15 Client/Project binding + pinned task-types additive fields on RepoConfig:
 * - Target: read_repo_config / write_repo_config in src/core/repo_config.ts
 * - Why: strict binding means a bound repo's sessions belong to its Client/Project
 *   implicitly; the binding + pinned vocabulary must round-trip without disturbing the
 *   existing US-06 `jobs` cache, and format_version stays 2.
 */
export function run_repo_config_binding_tests(): void {
    const root = mkdir_tmp("binding");
    const cfg_path = path.join(root, "config.json");
    const repo_id = generate_repo_id();

    // Absent binding/pinned_task_types reads as unbound (undefined).
    write_repo_config(cfg_path, { repo_id, format_version: REPO_CONFIG_FORMAT_VERSION });
    const unbound = read_repo_config(cfg_path)!;
    assert.strictEqual(unbound.binding, undefined, "absent binding reads as undefined");
    assert.strictEqual(unbound.pinned_task_types, undefined, "absent pinned_task_types reads as undefined");
    assert.strictEqual(unbound.format_version, REPO_CONFIG_FORMAT_VERSION, "format_version stays 2");

    // Round-trip of binding + pinned_task_types, alongside the existing jobs cache.
    write_repo_config(cfg_path, {
        repo_id,
        format_version: REPO_CONFIG_FORMAT_VERSION,
        jobs: [{ job_id: "16lor", job_title: "test-issue9" }],
        binding: { client_id: "c1", project_id: "p1" },
        pinned_task_types: ["t1", "t2"],
    });
    const bound = read_repo_config(cfg_path)!;
    assert.deepStrictEqual(bound.binding, { client_id: "c1", project_id: "p1" }, "binding round-trips");
    assert.deepStrictEqual(bound.pinned_task_types, ["t1", "t2"], "pinned_task_types round-trips");
    assert.strictEqual(bound.jobs!.length, 1, "existing jobs cache untouched by binding fields");
    assert.strictEqual(bound.jobs![0].job_title, "test-issue9", "jobs cache content untouched");
    assert.strictEqual(bound.format_version, REPO_CONFIG_FORMAT_VERSION, "format_version stays 2 when bound");

    // Malformed binding (missing a field) is dropped, tolerant style.
    fs.writeFileSync(cfg_path, JSON.stringify({ repo_id, binding: { client_id: "c1" } }) + "\n", "utf8");
    assert.strictEqual(read_repo_config(cfg_path)!.binding, undefined, "malformed binding dropped");

    // Non-string entries in pinned_task_types are filtered out.
    fs.writeFileSync(cfg_path, JSON.stringify({ repo_id, pinned_task_types: ["t1", 2, null, "t2"] }) + "\n", "utf8");
    assert.deepStrictEqual(read_repo_config(cfg_path)!.pinned_task_types, ["t1", "t2"], "non-string pinned entries dropped");
}
