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
}

/** Normalize a filesystem path for stable comparison (case-insensitive on Windows). */
function normalize_path(p: string): string {
    const n = path.normalize(p).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? n.toLowerCase() : n;
}

/**
 * Immutable registry of known repos. In #48 it tracks repos only; client /
 * project / task-type entity lists arrive with #15. Mutations return new
 * instances (only Runtime is mutable, per the domain rules).
 */
export class Registry {
    private readonly _repos: ReadonlyArray<RepoEntry>;

    private constructor(repos: RepoEntry[]) {
        this._repos = repos;
    }

    static empty(): Registry {
        return new Registry([]);
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
        return new Registry(repos);
    }

    get repos(): RepoEntry[] {
        return this._repos.slice();
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
        return new Registry(next);
    }

    to_dto(): RegistryDTO {
        return {
            format_version: REGISTRY_FORMAT_VERSION,
            repos: this._repos.map(r => ({ ...r })),
        };
    }
}
