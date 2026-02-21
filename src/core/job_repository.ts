import * as fs from "fs";
import * as path from "path";
import { TimeScopePaths } from "./paths";
import { Job } from "./job";
import { JobCollection } from "./job_collection";
import { JobDTO } from "./job_dto";
import { ensureDirExists, readJSONSafe } from "../utils/fs_utils";

export class JobRepository {
  private readonly paths: TimeScopePaths;

  constructor(paths: TimeScopePaths) {
    this.paths = paths;
  }


  /**
   * Load all jobs from the canonical jobs file and return a JobCollection.
   */
  public async loadAll(): Promise<JobCollection> {
    const raw = await readJSONSafe(this.paths.global_jobs_path);
    if (!raw) return JobCollection.fromArray([]);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (ex) {
      throw new Error(`Malformed jobs file: invalid JSON: ${String(ex)}`);
    }

    // Detect legacy jobs file format: JSON array of strings (job names).
    // Fail fast with an actionable message so developers can run the
    // standalone upgrade script. Do NOT attempt to upgrade here.
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      throw new Error(
        "Legacy job file format detected. Run `scripts/upgrade_jobs.ts` to convert this file to the canonical JobDTO format."
      );
    }

    if (!Array.isArray(parsed)) throw new Error("Jobs file must be a JSON array of job records");

    const jobs: Job[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      try {
        const dto = this.validateDTO(item, i);
        const job = this.fromDTO(dto);
        jobs.push(job);
      } catch (ex) {
        throw new Error(`Invalid job record at index ${i}: ${String((ex as Error).message)}`);
      }
    }

    // Normalize ordering: created ascending (JobCollection.fromArray also sorts, but keep explicit)
    const sorted = jobs.slice().sort((a, b) => a.createdAt - b.createdAt);
    return JobCollection.fromArray(sorted);
  }

  /**
   * Save a new job record. Throws if job with same id already exists.
   */
  public async save(job: Job): Promise<void> {
    const all = await this.loadAll();
    if (all.hasId(job.id)) throw new Error(`JobRepository.save: job id '${job.id}' already exists`);
    const nextArr = all.toArray().slice();
    nextArr.push(job);
    nextArr.sort((a, b) => a.createdAt - b.createdAt);
    const dtos = nextArr.map(j => this.toDTO(j));
    await this.writeFile(dtos);
  }

  /**
   * Replace an existing job record by id. Throws if not found.
   */
  public async update(job: Job): Promise<void> {
    const all = await this.loadAll();
    if (!all.hasId(job.id)) throw new Error(`JobRepository.update: job id '${job.id}' not found`);
    const nextArr = all.toArray().map(j => (j.id === job.id ? job : j));
    nextArr.sort((a, b) => a.createdAt - b.createdAt);
    const dtos = nextArr.map(j => this.toDTO(j));
    await this.writeFile(dtos);
  }

  /**
   * Delete a job by id. No-op if not present.
   */
  public async delete(jobId: string): Promise<void> {
    const all = await this.loadAll();
    if (!all.hasId(jobId)) return;
    const nextArr = all.toArray().filter(j => j.id !== jobId);
    const dtos = nextArr.map(j => this.toDTO(j));
    await this.writeFile(dtos);
  }

  // --------------------------
  // Serialization helpers
  // --------------------------
  public toDTO(job: Job): JobDTO {
    const dto: JobDTO = {
      job_id: job.id,
      job_title: job.title,
      // Only include is_archived when true to match optional semantics
      created: job.createdAt,
      job_seed: job.seed
    } as JobDTO;
    if (job.archived) dto.is_archived = true;
    if (job.lastModifiedAt !== undefined && job.lastModifiedAt !== job.createdAt) dto.last_modified = job.lastModifiedAt;
    return dto;
  }

  public fromDTO(dto: JobDTO): Job {
    // Delegate identity validation and construction to domain factory
    return Job.create({
      title: dto.job_title,
      seedTitle: dto.job_seed,
      jobId: dto.job_id,
      created: dto.created,
      lastModified: dto.last_modified,
      isArchived: Boolean(dto.is_archived)
    });
  }

  public toJSONL(dto: JobDTO): string {
    return JSON.stringify(dto);
  }

  public fromJSONL(line: string): JobDTO {
    try {
      const obj = JSON.parse(line);
      return this.validateDTO(obj);
    } catch (ex) {
      throw new Error(`Invalid JSON line for JobDTO: ${String(ex)}`);
    }
  }

  // --------------------------
  // Validation
  // --------------------------
  private validateDTO(obj: any, index?: number): JobDTO {
    if (!obj || typeof obj !== "object") throw new Error("JobDTO must be an object");

    const job_id = obj.job_id;
    if (typeof job_id !== "string" || !/^[0-9a-z]{5}$/.test(job_id)) {
      throw new Error("job_id must be a 5-character lowercase base36 string");
    }

    const job_title = obj.job_title;
    if (typeof job_title !== "string" || job_title.trim().length === 0) {
      throw new Error("job_title must be a non-empty string");
    }

    const created = obj.created;
    if (typeof created !== "number" || !Number.isFinite(created) || created < 0) {
      throw new Error("created must be a non-negative finite number");
    }

    const job_seed = obj.job_seed;
    if (typeof job_seed !== "string" || job_seed.trim().length === 0) {
      throw new Error("job_seed must be a non-empty string");
    }

    if (obj.is_archived !== undefined && typeof obj.is_archived !== "boolean") throw new Error("is_archived must be boolean if present");

    if (obj.last_modified !== undefined) {
      if (typeof obj.last_modified !== "number" || !Number.isFinite(obj.last_modified) || obj.last_modified < created) {
        throw new Error("last_modified must be a finite number >= created");
      }
    }

    const dto: JobDTO = {
      job_id,
      job_title,
      created,
      job_seed
    };
    if (obj.is_archived) dto.is_archived = true;
    if (obj.last_modified !== undefined) dto.last_modified = obj.last_modified;
    return dto;
  }

  // --------------------------
  // Disk helpers
  // --------------------------
  private async writeFile(dtos: JobDTO[]): Promise<void> {
    const filePath = this.paths.global_jobs_path;
    if (!filePath) throw new Error("No global jobs path configured");
    await ensureDirExists(filePath);
    try {
      // Preserve canonical ordering: created ascending, tiebreak by job_id
      const sorted = dtos.slice().sort((a, b) => {
        if (a.created !== b.created) return a.created - b.created;
        return a.job_id.localeCompare(b.job_id);
      });
      await fs.promises.writeFile(filePath, JSON.stringify(sorted, null, 2) + "\n", "utf8");
    } catch (ex) {
      throw new Error(`Failed to write jobs file: ${String(ex)}`);
    }
  }
}
