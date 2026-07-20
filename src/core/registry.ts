import * as path from "path";

export const REGISTRY_FORMAT_VERSION = 1;

/** One known repo in the global registry (the cache used for #48 rebuild + dedup). */
export interface RepoEntry {
    id: string;
    name: string;
    path: string;
    last_seen: number;
}

export interface RegistryDTO {
    format_version: number;
    repos: RepoEntry[];
    /** Folders the user declined to track ("Never for this folder"). Per-machine (#48/#6). */
    declined: string[];
}

/** Normalize a filesystem path for stable comparison (case-insensitive on Windows). */
function normalize_path(p: string): string {
    const n = path.normalize(p).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? n.toLowerCase() : n;
}

/**
 * Immutable registry of known repos + declined folders. In #48 it tracks repos and
 * per-folder opt-out declines; client / project / task-type entity lists arrive with
 * #15. Mutations return new instances (only Runtime is mutable, per the domain rules).
 */
export class Registry {
    private readonly _repos: ReadonlyArray<RepoEntry>;
    private readonly _declined: ReadonlyArray<string>;

    private constructor(repos: RepoEntry[], declined: string[]) {
        this._repos = repos;
        this._declined = declined;
    }

    static empty(): Registry {
        return new Registry([], []);
    }

    static from_dto(obj: unknown): Registry {
        const rec = (obj ?? {}) as Record<string, unknown>;
        const rawRepos = Array.isArray(rec.repos) ? rec.repos : [];
        const repos: RepoEntry[] = [];
        for (const item of rawRepos) {
            const r = item as Record<string, unknown>;
            if (!r || typeof r.id !== "string" || typeof r.path !== "string") continue;
            repos.push({
                id: r.id,
                name: typeof r.name === "string" ? r.name : "",
                path: r.path,
                last_seen: typeof r.last_seen === "number" ? r.last_seen : 0,
            });
        }
        const rawDeclined = Array.isArray(rec.declined) ? rec.declined : [];
        const declined = rawDeclined.filter((d): d is string => typeof d === "string");
        return new Registry(repos, declined);
    }

    get repos(): RepoEntry[] {
        return this._repos.slice();
    }

    get declined_paths(): string[] {
        return this._declined.slice();
    }

    find_by_id(id: string): RepoEntry | undefined {
        return this._repos.find(r => r.id === id);
    }

    find_by_path(p: string): RepoEntry | undefined {
        const target = normalize_path(p);
        return this._repos.find(r => normalize_path(r.path) === target);
    }

    /** Add the repo, or replace the existing entry with the same id. Returns a new Registry. */
    upsert_repo(entry: RepoEntry): Registry {
        const next = this._repos.filter(r => r.id !== entry.id);
        next.push({ ...entry });
        return new Registry(next, this._declined.slice());
    }

    /** True when the folder was declined ("Never for this folder"). Path-normalized. */
    is_declined(p: string): boolean {
        const target = normalize_path(p);
        return this._declined.some(d => normalize_path(d) === target);
    }

    /** Record a declined folder (no-op if already present). Returns a new Registry. */
    add_declined(p: string): Registry {
        if (this.is_declined(p)) return this;
        return new Registry(this._repos.slice(), [...this._declined, p]);
    }

    /** Clear a folder's decline — the underlying reverse of opt-out (UI is #6). No-op (same instance) if not declined. */
    remove_declined(p: string): Registry {
        if (!this.is_declined(p)) return this;
        const target = normalize_path(p);
        return new Registry(this._repos.slice(), this._declined.filter(d => normalize_path(d) !== target));
    }

    to_dto(): RegistryDTO {
        return {
            format_version: REGISTRY_FORMAT_VERSION,
            repos: this._repos.map(r => ({ ...r })),
            declined: this._declined.slice(),
        };
    }
}
