#!/usr/bin/env ts-node

import * as fs from "fs";
import * as path from "path";
import { Job } from "../src/core/job";

/**
 * One-time developer script to upgrade legacy jobs files (array of strings)
 * into the canonical JobDTO array format used by the extension.
 *
 * Usage:
 *   node scripts/upgrade_jobs.js <path-to-jobs-file>
 *
 * Notes:
 * - This script is intentionally simple and does NOT depend on VS Code APIs.
 * - It does NOT modify any domain/repository source files.
 * - It is safe to run manually and is idempotent (re-running on an already-upgraded
 *   file will print "Already upgraded" and do nothing).
 */

function usage(): never {
  console.error("Usage: node scripts/upgrade_jobs.js <path-to-jobs-file>");
  process.exit(2);
}

if (process.argv.length < 3) usage();

const jobsPath = process.argv[2];

if (!jobsPath) usage();

function readJsonFile(p: string): unknown {
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  const raw = fs.readFileSync(p, "utf8");
  try {
    return JSON.parse(raw);
  } catch (ex) {
    throw new Error(`Failed to parse JSON in ${p}: ${String(ex)}`);
  }
}

function toDTOFromJob(job: Job): any {
  // Mirror JobRepository.toDTO exactly (no imports from repository to avoid vscode deps)
  const dto: any = {
    job_id: job.id,
    job_title: job.title,
    created: job.createdAt,
    job_seed: job.seed,
  };
  if (job.archived) dto.is_archived = true;
  if (job.lastModifiedAt !== undefined && job.lastModifiedAt !== job.createdAt) dto.last_modified = job.lastModifiedAt;
  return dto;
}

function writeAtomicJsonArray(targetPath: string, arr: any[]): void {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmpName = `.upgrade_jobs.tmp.${process.pid}.${Date.now()}`;
  const tmpPath = path.join(dir, tmpName);

  const payload = JSON.stringify(arr, null, 2) + "\n";

  fs.writeFileSync(tmpPath, payload, { encoding: "utf8", flag: "w" });
  fs.renameSync(tmpPath, targetPath);
}

try {
  const parsed = readJsonFile(jobsPath);

  if (!Array.isArray(parsed)) {
    throw new Error("Jobs file must be a JSON array (either legacy array-of-strings or canonical array-of-objects).");
  }

  // Empty array -> nothing to do (treat as already upgraded)
  if (parsed.length === 0) {
    console.log("Already upgraded (empty jobs array).");
    process.exit(0);
  }

  const allStrings = parsed.every((x) => typeof x === "string");
  const allObjectsWithId = parsed.every((x) => x && typeof x === "object" && typeof (x as any).job_id === "string");

  if (allObjectsWithId) {
    console.log("Already upgraded.");
    process.exit(0);
  }

  if (!allStrings) {
    throw new Error("Unrecognized jobs file format: expected either array-of-strings (legacy) or array-of-JobDTO objects (canonical).");
  }

  // Legacy format detected
  console.log(`Legacy format detected (${parsed.length} job(s)).`);
  console.log(`Upgrading ${parsed.length} job(s)...`);

  const titles: string[] = parsed as string[];

  // Create Job domain objects and map to DTOs
  const dtos = titles.map((title) => {
    const job = Job.create({ title });
    return toDTOFromJob(job);
  });

  // Sort: created ascending, tiebreak by job_id (match JobRepository.writeFile)
  dtos.sort((a: any, b: any) => {
    if (a.created !== b.created) return a.created - b.created;
    return String(a.job_id).localeCompare(String(b.job_id));
  });

  // Write atomically
  writeAtomicJsonArray(jobsPath, dtos);

  console.log("Upgrade complete.");
  console.log(`Output written to ${jobsPath}`);
  process.exit(0);
} catch (err) {
  console.error("Upgrade failed:", (err as Error).message || err);
  process.exit(1);
}
