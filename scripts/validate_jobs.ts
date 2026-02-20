#!/usr/bin/env ts-node

import * as fs from "fs";
import * as path from "path";
import { Job } from "../src/core/job";

function usage(): never {
    console.error("Usage: npx ts-node scripts/validate_jobs.ts <path-to-jobs.json>");
    process.exit(2);
}

if (process.argv.length < 3) usage();
const jobsPath = process.argv[2];
if (!jobsPath) usage();

try {
    if (!fs.existsSync(jobsPath)) throw new Error(`File not found: ${jobsPath}`);
    const raw = fs.readFileSync(jobsPath, "utf8");
    const data = JSON.parse(raw);

    let arr: any[];
    if (Array.isArray(data)) {
        arr = data;
    } else if (data && typeof data === "object") {
        // maybe an object mapping job_id -> record
        arr = Object.values(data);
    } else {
        throw new Error("Unexpected jobs.json shape");
    }

    const errors: string[] = [];
    for (let i = 0; i < arr.length; i++) {
        const rec = arr[i];
        const idx = i;
        try {
            if (!rec || typeof rec !== 'object') throw new Error('record not an object');
            const jobId = rec.job_id || rec.jobId || rec.id;
            const jobTitle = rec.job_title || rec.title || rec.jobTitle;
            const jobSeed = rec.job_seed || rec.jobSeed || jobTitle;
            const created = rec.created ?? rec.created_at ?? Date.now();
            const lastModified = rec.last_modified ?? rec.lastModified ?? created;
            const isArchived = rec.is_archived ?? rec.isArchived ?? false;
            // Attempt to create a Job using the canonical factory which validates identity
            Job.create({ title: jobTitle, seedTitle: jobSeed, jobId: jobId, created, lastModified, isArchived });
        } catch (err) {
            errors.push(`index ${idx}: ${(err as Error).message || err}`);
        }
    }

    if (errors.length === 0) {
        console.log(`Validation OK: ${arr.length} job(s) parsed and validated.`);
        process.exit(0);
    } else {
        console.error(`Validation FAILED: ${errors.length} error(s)`);
        for (const e of errors) console.error(`  ${e}`);
        process.exit(2);
    }
} catch (err) {
    console.error("Validation failed:", (err as Error).message || err);
    process.exit(1);
}
