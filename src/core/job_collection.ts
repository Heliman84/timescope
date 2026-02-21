import { Job } from './job';

/**
 * Immutable collection (aggregate) of `Job` domain objects.
 *
 * - All operations return a new `JobCollection`.
 * - Internal storage is a private readonly array.
 * - No I/O, no DTOs, no repositories.
 */
export class JobCollection {
	private readonly jobs: Job[];

	// Private constructor - trusts validated inputs (must be Job instances and unique ids)
	private constructor(jobs: Job[]) {
		this.jobs = jobs;
	}

	// Factory: validates items are Job instances, enforces unique ids, normalizes ordering
	public static fromArray(jobs: Job[]): JobCollection {
		if (!Array.isArray(jobs)) throw new Error('JobCollection.fromArray expects an array');

		// Validate all items are Job instances
		for (const j of jobs) {
			if (!(j instanceof Job)) throw new Error('JobCollection.fromArray: all items must be Job instances');
		}

		// Validate uniqueness of job ids
		const seen = new Set<string>();
		for (const j of jobs) {
			const id = j.id;
			if (seen.has(id)) throw new Error(`JobCollection.fromArray: duplicate job id '${id}'`);
			seen.add(id);
		}

		// Normalize ordering: createdAt ascending
		const normalized = jobs.slice().sort((a, b) => a.createdAt - b.createdAt);
		return new JobCollection(normalized);
	}

	size(): number { return this.jobs.length; }
	isEmpty(): boolean { return this.jobs.length === 0; }

	// Defensive copy
	toArray(): readonly Job[] { return this.jobs.slice(); }

	findById(id: string): Job | undefined { return this.jobs.find(j => j.id === id); }
	hasId(id: string): boolean { return this.findById(id) !== undefined; }

	add(job: Job): JobCollection {
		if (!(job instanceof Job)) throw new Error('JobCollection.add: job must be instance of Job');
		if (this.hasId(job.id)) throw new Error(`JobCollection.add: job id '${job.id}' already exists`);
		const next = this.jobs.slice();
		next.push(job);
		next.sort((a, b) => a.createdAt - b.createdAt);
		return new JobCollection(next);
	}

	remove(jobId: string): JobCollection {
		if (!this.hasId(jobId)) return this;
		const next = this.jobs.filter(j => j.id !== jobId);
		return new JobCollection(next);
	}

	update(job: Job): JobCollection {
		if (!(job instanceof Job)) throw new Error('JobCollection.update: job must be instance of Job');
		const idx = this.jobs.findIndex(j => j.id === job.id);
		if (idx === -1) throw new Error(`JobCollection.update: job id '${job.id}' not found`);
		const next = this.jobs.slice();
		next[idx] = job;
		next.sort((a, b) => a.createdAt - b.createdAt);
		return new JobCollection(next);
	}

	rename(jobId: string, newTitle: string): JobCollection {
		const idx = this.jobs.findIndex(j => j.id === jobId);
		if (idx === -1) throw new Error(`JobCollection.rename: job id '${jobId}' not found`);
		const target = this.jobs[idx];
		const renamed = target.rename(newTitle);
		const next = this.jobs.slice();
		next[idx] = renamed;
		next.sort((a, b) => a.createdAt - b.createdAt);
		return new JobCollection(next);
	}

	filterArchived(): JobCollection { return new JobCollection(this.jobs.filter(j => j.archived)); }
	filterActive(): JobCollection { return new JobCollection(this.jobs.filter(j => !j.archived)); }

	sortByCreated(): JobCollection {
		return new JobCollection(this.jobs.slice().sort((a, b) => a.createdAt - b.createdAt));
	}

	sortByLastModified(): JobCollection {
		return new JobCollection(this.jobs.slice().sort((a, b) => a.lastModifiedAt - b.lastModifiedAt));
	}
}

