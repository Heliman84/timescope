import { compute_seeded_id } from "./id_gen";

// Temporary Job record shape used by the domain. This will be moved to the
// infrastructure layer as a proper DTO in Step 3.
export type JobRecord = {
  job_id: string;
  job_title: string;
  is_archived: boolean;
  created: number;
  last_modified: number;
  job_seed: string;
};

type JobCreateProps = {
  title: string;
  /** The original seed title used to derive identity. If omitted, `title` is used. */
  seedTitle?: string;
  /** Optional explicit job id (for reconstruction). If provided it's validated against the seed. */
  jobId?: string;
  created?: number;
  lastModified?: number;
  isArchived?: boolean;
};

export class Job {
  // Private readonly domain fields (underscore-prefixed to match Event conventions)
  private readonly _id: string;
  private readonly _title: string;
  private readonly _archived: boolean;
  private readonly _createdAt: number;
  private readonly _lastModifiedAt: number;
  private readonly _seed: string;
  /** True when the Job was reconstructed from event fields only (id + title). */
  private readonly _partial: boolean;

  // Private constructor - trusts validated inputs
  private constructor(props: {
    jobId: string;
    title: string;
    isArchived: boolean;
    created: number;
    lastModified: number;
    jobSeed: string;
    partial?: boolean;
  }) {
    this._id = props.jobId;
    this._title = props.title;
    this._archived = props.isArchived;
    this._createdAt = props.created;
    this._lastModifiedAt = props.lastModified;
    this._seed = props.jobSeed;
    this._partial = props.partial ?? false;
  }

  /**
   * Factory that validates invariants, enforces identity rules, and normalizes timestamps/flags.
   */
  public static create(input: JobCreateProps): Job {
    const title = (input.title ?? '').trim();
    if (!title) throw new Error('Job.create: `title` must be a non-empty string');

    const seedTitle = (input.seedTitle ?? input.title).trim();
    if (!seedTitle) throw new Error('Job.create: `seedTitle` must be a non-empty string');

    const created = typeof input.created === 'number' && Number.isFinite(input.created)
      ? Math.floor(input.created)
      : Date.now();

    if (created < 0) throw new Error('Job.create: `created` must be >= 0');

    const lastModified = typeof input.lastModified === 'number' && Number.isFinite(input.lastModified)
      ? Math.floor(input.lastModified)
      : created;

    if (lastModified < created) throw new Error('Job.create: `lastModified` cannot be earlier than `created`');

    const isArchived = Boolean(input.isArchived);

    // Enforce identity: compute canonical jobId from seedTitle and validate if jobId provided
    const computedId = Job.computeJobIdFromSeed(seedTitle);
    if (input.jobId && String(input.jobId) !== computedId) {
      throw new Error('Job.create: provided `jobId` does not match `seedTitle`');
    }

    return new Job({
      jobId: computedId,
      title,
      isArchived,
      created,
      lastModified,
      jobSeed: seedTitle,
    });
  }

  // Property-style getters (Event conventions)
  get id(): string { return this._id; }
  get title(): string { return this._title; }
  get archived(): boolean { return this._archived; }
  get createdAt(): number { return this._createdAt; }
  get lastModifiedAt(): number { return this._lastModifiedAt; }
  get seed(): string { return this._seed; }
  /** True when constructed via `fromEventFields` — only `id` and `title` are trustworthy. */
  get partial(): boolean { return this._partial; }

  // Domain behavior: return new Job instances with updated state
  public rename(newTitle: string): Job {
    const t = (newTitle ?? '').trim();
    if (!t) throw new Error('Job.rename: `newTitle` must be a non-empty string');
    if (t === this._title) return this;
    return new Job({
      jobId: this._id,
      title: t,
      isArchived: this._archived,
      created: this._createdAt,
      lastModified: Date.now(),
      jobSeed: this._seed,
    });
  }

  public archive(): Job {
    if (this._archived) return this;
    return new Job({
      jobId: this._id,
      title: this._title,
      isArchived: true,
      created: this._createdAt,
      lastModified: Date.now(),
      jobSeed: this._seed,
    });
  }

  public unarchive(): Job {
    if (!this._archived) return this;
    return new Job({
      jobId: this._id,
      title: this._title,
      isArchived: false,
      created: this._createdAt,
      lastModified: Date.now(),
      jobSeed: this._seed,
    });
  }

  /**
   * Produce a plain object matching the canonical job record shape in `jobs.json`.
   */
  public toRecord(): JobRecord {
    return {
      job_id: this._id,
      job_title: this._title,
      is_archived: this._archived,
      created: this._createdAt,
      last_modified: this._lastModifiedAt,
      job_seed: this._seed,
    };
  }

  toString(): string {
      return `Job(${this.id}, "${this.title}")`;
  }

  /**
   * Domain equality: jobs are equal when their ids match (identity).
   */
  public equals(other: Job): boolean {
    if (!other) return false;
    return this._id === other._id;
  }

  /**
   * Reconstruct a Job from persisted event fields (e.g. when loading sessions from logs).
   * Bypasses seed-to-id validation since the original seed title may differ from the
   * current title after a rename. The resulting Job is suitable for in-memory use
   * (session tracking, event creation) but should NOT be persisted back to the jobs file
   * without the full metadata from JobRepository.
   */
  public static fromEventFields(jobId: string, title: string): Job {
    if (typeof jobId !== 'string' || jobId.length === 0) throw new Error('Job.fromEventFields: `jobId` must be a non-empty string');
    if (typeof title !== 'string' || title.length === 0) throw new Error('Job.fromEventFields: `title` must be a non-empty string');
    const now = Date.now();
    return new Job({
      jobId,
      title,
      isArchived: false,
      created: now,
      lastModified: now,
      jobSeed: title,
      partial: true,
    });
  }


  // ------------------
  // Private helpers (domain logic kept inside the class)
  // ------------------
  private static computeJobIdFromSeed(seed: string): string {
    return compute_seeded_id(seed, 5);
  }
}
