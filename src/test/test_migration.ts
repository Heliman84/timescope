import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { Event } from "../core/event";
import { Job } from "../core/job";
import { migrate_legacy_global_log } from "../core/migration";
import { append_owned_event } from "../core/global_index";

function mkdir_tmp(suffix: string): string {
    const root = path.join(__dirname, "..", "..", "test-output", `migration-${suffix}-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
    return root;
}

function ev(job: Job, type: "start" | "stop" | "pause" | "resume", ts: number, task?: string): Event {
    return Event.create(job, type, ts, task);
}

function event_ids(file_path: string): string[] {
    if (!fs.existsSync(file_path)) return [];
    return fs.readFileSync(file_path, "utf8")
        .split(/\r?\n/)
        .filter(l => l.trim().length > 0)
        .map(l => Event.fromJSONL(l))
        .filter((e): e is Event => !!e)
        .map(e => e.id);
}

/**
 * Tests the legacy-global-log migration (#48 48c):
 * - Target: migrate_legacy_global_log in src/core/migration.ts
 * - What: moves legacy `logs.jsonl` events into the owned `scratch.jsonl`, backs the
 *   legacy file up first, de-dupes by id, and retires the legacy file (one-shot).
 * - Why: the cutover must be non-destructive and idempotent — history is preserved and
 *   never re-migrated.
 */
export function run_migration_tests(): void {
    // ── Basic migration ──────────────────────────────────────────────────────
    {
        const root = mkdir_tmp("basic");
        const legacy = path.join(root, "logs.jsonl");
        const scratch = path.join(root, "scratch.jsonl");
        const job = Job.create({ title: "legacy work" });

        const header = JSON.stringify({ _format_version: 2 });
        fs.writeFileSync(
            legacy,
            [header, ev(job, "start", 1000).toJSONL(), ev(job, "stop", 2000).toJSONL()].join("\n") + "\n",
            "utf8"
        );

        const result = migrate_legacy_global_log(legacy, scratch);

        assert.strictEqual(result.migrated, 2, "two legacy events migrated");
        assert.ok(result.backup_path && fs.existsSync(result.backup_path), "backup written before removal");
        assert.strictEqual(fs.existsSync(legacy), false, "legacy file retired after migration");
        assert.strictEqual(event_ids(scratch).length, 2, "scratch now owns the two events");
    }

    // ── De-dupe: events already in scratch are not duplicated ─────────────────
    {
        const root = mkdir_tmp("dedupe");
        const legacy = path.join(root, "logs.jsonl");
        const scratch = path.join(root, "scratch.jsonl");
        const job = Job.create({ title: "legacy work" });

        const start = ev(job, "start", 1000);
        const stop = ev(job, "stop", 2000);
        // scratch already contains the start (e.g. a prior partial replication)
        append_owned_event(scratch, start);

        const header = JSON.stringify({ _format_version: 2 });
        fs.writeFileSync(legacy, [header, start.toJSONL(), stop.toJSONL()].join("\n") + "\n", "utf8");

        const result = migrate_legacy_global_log(legacy, scratch);

        assert.strictEqual(result.migrated, 1, "only the new event migrated (start deduped)");
        const ids = event_ids(scratch);
        assert.strictEqual(ids.length, 2, "scratch holds two unique events, no duplicate");
        assert.strictEqual(new Set(ids).size, 2, "ids are unique");
    }

    // ── No legacy file → no-op; and a second call is idempotent ───────────────
    {
        const root = mkdir_tmp("noop");
        const legacy = path.join(root, "logs.jsonl");
        const scratch = path.join(root, "scratch.jsonl");

        const first = migrate_legacy_global_log(legacy, scratch);
        assert.strictEqual(first.migrated, 0, "missing legacy file migrates nothing");
        assert.strictEqual(fs.existsSync(scratch), false, "no scratch created for a no-op migration");

        // After a real migration the legacy file is gone, so re-running is a no-op.
        const job = Job.create({ title: "x" });
        fs.writeFileSync(legacy, JSON.stringify({ _format_version: 2 }) + "\n" + ev(job, "start", 1).toJSONL() + "\n", "utf8");
        assert.strictEqual(migrate_legacy_global_log(legacy, scratch).migrated, 1, "first run migrates");
        assert.strictEqual(migrate_legacy_global_log(legacy, scratch).migrated, 0, "second run is idempotent");
    }

    console.log("  ✓ legacy-global-log migration tests passed");
}
