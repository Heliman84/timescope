import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { load_build_info, format_status_bar_suffix, format_build_info_full, BuildInfo } from "../core/build_info";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkExtensionRoot(suffix: string): string {
    const root = path.join(__dirname, "..", "..", "test-output", `build-info-${suffix}-${Date.now()}`);
    fs.mkdirSync(path.join(root, "out"), { recursive: true });
    return root;
}

function writeBuildInfo(root: string, contents: unknown): void {
    fs.writeFileSync(path.join(root, "out", "buildinfo.json"), JSON.stringify(contents), "utf8");
}

// ═══════════════════════════════════════════════════════════════════════════
// load_build_info
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests load_build_info happy path:
 * - Target: load_build_info in src/core/build_info.ts
 * - What: reads and parses a well-formed out/buildinfo.json.
 * - Does: writes a valid buildinfo.json, loads it, checks all fields.
 * - Why: this is the primary read path used by the status bar, dashboard,
 *   and the Show Build Info command. Regenerated on every compile
 *   (vscode:prepublish), so F5 and packaged installs both read a current file.
 */
export function run_load_build_info_valid_tests(): void {
    const root = mkExtensionRoot("valid");
    const info: BuildInfo = { version: "0.3.0", commit: "a1b2c3d4e5f6", branch: "develop", build_date: "2026-07-16T00:00:00.000Z" };
    writeBuildInfo(root, info);

    const loaded = load_build_info(root);
    assert.ok(loaded, "should load build info");
    assert.strictEqual(loaded!.version, "0.3.0");
    assert.strictEqual(loaded!.commit, "a1b2c3d4e5f6");
    assert.strictEqual(loaded!.branch, "develop");
    assert.strictEqual(loaded!.build_date, "2026-07-16T00:00:00.000Z");

    console.log("  ✓ load_build_info valid tests passed");
}

/**
 * Tests load_build_info graceful fallback — missing file:
 * - Target: load_build_info in src/core/build_info.ts
 * - What: packages built without out/buildinfo.json (e.g. old vsix, dev build
 *   run directly from source without `npm run package`) must not throw.
 * - Does: points at an extension root with no buildinfo.json, asserts null.
 * - Why: this is the fallback path the issue explicitly requires.
 */
export function run_load_build_info_missing_tests(): void {
    const root = mkExtensionRoot("missing");
    const loaded = load_build_info(root);
    assert.strictEqual(loaded, null, "missing file → null");

    console.log("  ✓ load_build_info missing-file tests passed");
}

/**
 * Tests load_build_info graceful fallback — malformed content:
 * - Target: load_build_info in src/core/build_info.ts
 * - What: a corrupted or partial buildinfo.json must not crash the extension.
 * - Does: writes invalid JSON and JSON missing required fields, asserts null
 *   in both cases.
 * - Why: build metadata is best-effort display, never load-bearing —
 *   a bad file must degrade to "no build info", not an activation error.
 */
export function run_load_build_info_malformed_tests(): void {
    const root1 = mkExtensionRoot("malformed-json");
    fs.writeFileSync(path.join(root1, "out", "buildinfo.json"), "{ not valid json", "utf8");
    assert.strictEqual(load_build_info(root1), null, "invalid JSON → null");

    const root2 = mkExtensionRoot("malformed-shape");
    writeBuildInfo(root2, { version: "0.3.0" }); // missing commit/branch/build_date
    assert.strictEqual(load_build_info(root2), null, "missing required fields → null");

    console.log("  ✓ load_build_info malformed-content tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// format_status_bar_suffix / format_build_info_full
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests build info formatting helpers:
 * - Target: format_status_bar_suffix, format_build_info_full in src/core/build_info.ts
 * - What: pure string formatting for the tooltip (compact) and the fuller
 *   dashboard-footer/command-popup surface, plus the "no build info" fallback.
 *   format_build_info_full builds on format_status_bar_suffix rather than
 *   duplicating the version/sha construction — this asserts that composition.
 * - Does: formats a populated BuildInfo and a null BuildInfo for both helpers.
 * - Why: timer.ts, dashboard.ts, and extension.ts all render whatever these
 *   helpers return verbatim — formatting bugs here show up directly to the user.
 */
export function run_format_build_info_tests(): void {
    const info: BuildInfo = { version: "0.3.0", commit: "a1b2c3d4e5f6", branch: "develop", build_date: "2026-07-16T00:00:00.000Z" };

    const suffix = format_status_bar_suffix(info);
    assert.strictEqual(suffix, "v0.3.0 @ a1b2c3d", "status bar suffix format");

    const full = format_build_info_full(info);
    assert.strictEqual(full, "v0.3.0 @ a1b2c3d (2026-07-16T00:00:00.000Z)", "full format composes the status bar suffix");
    assert.ok(full.startsWith(suffix), "full format builds on the status bar suffix, not a separate construction");

    assert.strictEqual(format_status_bar_suffix(null), "no build info", "status bar fallback text");
    assert.strictEqual(format_build_info_full(null), "no build info", "full-format fallback text");

    console.log("  ✓ format_build_info tests passed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Exported runner
// ═══════════════════════════════════════════════════════════════════════════

export function run_build_info_tests(): void {
    console.log("build_info: load_build_info");
    run_load_build_info_valid_tests();
    run_load_build_info_missing_tests();
    run_load_build_info_malformed_tests();
    console.log("build_info: formatting");
    run_format_build_info_tests();
}
