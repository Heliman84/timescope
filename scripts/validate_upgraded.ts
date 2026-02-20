#!/usr/bin/env ts-node

import * as fs from "fs";
import * as path from "path";
import { Event } from "../src/core/event";

function usage(): never {
    console.error("Usage: npx ts-node scripts/validate_upgraded.ts <path-to-logs.jsonl>");
    process.exit(2);
}

if (process.argv.length < 3) usage();

const log_path = process.argv[2];
if (!log_path) usage();

try {
    if (!fs.existsSync(log_path)) throw new Error(`File not found: ${log_path}`);
    const raw = fs.readFileSync(log_path, "utf8");
    const lines = raw.split(/\r?\n/);

    let parsed_count = 0;
    let header_count = 0;
    const malformed: { index: number; snippet: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed === "") continue;

        // Try Event.fromJSONL
        const ev = Event.fromJSONL(trimmed);
        if (ev) {
            parsed_count++;
            continue;
        }

        // If Event.fromJSONL returned null, check if it's a header
        try {
            const obj = JSON.parse(trimmed);
            if (obj && typeof obj === "object" && (obj as any)._format_version !== undefined) {
                header_count++;
                continue;
            }
        } catch {
            // fall through
        }

        malformed.push({ index: i, snippet: trimmed.slice(0, 120) });
    }

    console.log(`Validation complete: ${parsed_count} events parsed, ${header_count} header(s), ${malformed.length} malformed line(s).`);
    if (malformed.length > 0) {
        console.warn("Malformed lines (index: snippet):");
        for (const m of malformed) {
            console.warn(`  ${m.index}: ${m.snippet}`);
        }
        process.exit(2);
    }
    process.exit(0);
} catch (err) {
    console.error("Validation failed:", (err as Error).message || err);
    process.exit(1);
}
