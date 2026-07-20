import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import {
    generate_repo_id,
    read_repo_config,
    write_repo_config,
    try_create_repo_config,
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

/**
 * Tests try_create_repo_config's exclusive-create semantics (#47 first-opt-in race):
 * - Target: try_create_repo_config in src/core/repo_config.ts
 * - What: creates on the first call (returns true); a second call against the same path
 *   returns false and does NOT overwrite — the on-disk repo_id stays the first writer's.
 * - Why: two windows racing to opt in the same never-before-seen folder must converge on a
 *   single repo identity instead of each minting (and briefly writing) their own.
 */
export function run_repo_config_exclusive_tests(): void {
    const root = mkdir_tmp("exclusive");
    const cfg_path = path.join(root, "config.json");

    const first_id = generate_repo_id();
    const created = try_create_repo_config(cfg_path, { repo_id: first_id, format_version: REPO_CONFIG_FORMAT_VERSION });
    assert.strictEqual(created, true, "first call creates the config");
    assert.strictEqual(read_repo_config(cfg_path)!.repo_id, first_id, "first writer's repo_id is on disk");

    const second_id = generate_repo_id();
    const created_again = try_create_repo_config(cfg_path, { repo_id: second_id, format_version: REPO_CONFIG_FORMAT_VERSION });
    assert.strictEqual(created_again, false, "second call against an existing config returns false");
    assert.strictEqual(read_repo_config(cfg_path)!.repo_id, first_id, "on-disk repo_id remains the first writer's, not overwritten");

    // #47 F4: the winner's content is always complete/parseable (never a partial write a
    // loser could observe), and no leftover temp file remains after either outcome.
    const winner = read_repo_config(cfg_path)!;
    assert.strictEqual(winner.format_version, REPO_CONFIG_FORMAT_VERSION, "winner's content is fully-formed, not partial");
    const leftover = fs.readdirSync(root).filter(f => f !== path.basename(cfg_path));
    assert.deepStrictEqual(leftover, [], "no leftover temp files after a winning create + a losing create");
}

/**
 * Tests try_create_repo_config's fallback when the volume doesn't support hardlinks
 * (#47 N1 — network shares / exFAT / FAT removable media raise a non-EEXIST error from
 * `fs.linkSync`, not "already exists"):
 * - Target: try_create_repo_config in src/core/repo_config.ts
 * - What: a non-EEXIST linkSync failure falls back to a plain `wx`-flagged exclusive
 *   write, which still succeeds (still OS-exclusive create, just not content-atomic on
 *   that degraded path) and leaves no leftover temp file.
 * - Why: the old plain `wx` write worked on these volumes; the F4 content-atomic upgrade
 *   must not hard-regress opt-in there.
 * - How: `fs.linkSync` is monkey-patched (Node's CommonJS module object is a live
 *   singleton, so this affects the same reference `repo_config.ts` calls through) to throw
 *   EPERM once, simulating a volume without hardlink support; restored in a `finally`.
 */
export function run_repo_config_fallback_tests(): void {
    const root = mkdir_tmp("fallback");
    const cfg_path = path.join(root, "config.json");
    const repo_id = generate_repo_id();

    const original_link_sync = fs.linkSync;
    let link_sync_called = false;
    (fs as { linkSync: typeof fs.linkSync }).linkSync = ((..._args: Parameters<typeof fs.linkSync>) => {
        link_sync_called = true;
        const err = new Error("EPERM: operation not permitted, link") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
    }) as typeof fs.linkSync;

    try {
        const created = try_create_repo_config(cfg_path, { repo_id, format_version: REPO_CONFIG_FORMAT_VERSION });
        assert.ok(link_sync_called, "the stub was actually exercised");
        assert.strictEqual(created, true, "a non-EEXIST linkSync error falls back to a successful wx write");
        assert.strictEqual(read_repo_config(cfg_path)!.repo_id, repo_id, "the fallback write's content is on disk");

        const leftover = fs.readdirSync(root).filter(f => f !== path.basename(cfg_path));
        assert.deepStrictEqual(leftover, [], "no leftover temp file after the fallback path");
    } finally {
        (fs as { linkSync: typeof fs.linkSync }).linkSync = original_link_sync;
    }
}
