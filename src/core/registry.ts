import * as path from "path";

export const REGISTRY_FORMAT_VERSION = 1;

/** One known repo in the global registry (the cache used for #48 rebuild + dedup). */
export interface RepoEntry {
    id: string;
    name: string;
    path: string;
    last_seen: number;
}

/** A client in the #15 global Client → Project → Task-type hierarchy. Display-only name. */
export interface ClientEntity {
    id: string;
    name: string;
}

/** A project belonging to a client. Display-only name. */
export interface ProjectEntity {
    id: string;
    name: string;
    client_id: string;
}

/**
 * A task-type: the global vocabulary shared across repos (#15). Events still reference
 * a task-type via the existing `job_id`/`job` fields — task-types are never persisted
 * to events or `jobs.json`. `aliases` are adopted legacy `job_id`s (see `convert_legacy_job`
 * in `task_types.ts`). Schema intentionally leaves room for a later optional
 * `owner_project` without a migration.
 */
export interface TaskTypeEntity {
    id: string;
    name: string;
    aliases?: string[];
}

export interface RegistryDTO {
    format_version: number;
    repos: RepoEntry[];
    /** Folders the user declined to track ("Never for this folder"). Per-machine (#48/#6). */
    declined: string[];
    /** #15 hierarchy — additive/optional so older registry.json files still load. */
    clients?: ClientEntity[];
    projects?: ProjectEntity[];
    task_types?: TaskTypeEntity[];
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
    private readonly _clients: ReadonlyArray<ClientEntity>;
    private readonly _projects: ReadonlyArray<ProjectEntity>;
    private readonly _task_types: ReadonlyArray<TaskTypeEntity>;

    private constructor(
        repos: RepoEntry[],
        declined: string[],
        clients: ClientEntity[] = [],
        projects: ProjectEntity[] = [],
        task_types: TaskTypeEntity[] = [],
    ) {
        this._repos = repos;
        this._declined = declined;
        this._clients = clients;
        this._projects = projects;
        this._task_types = task_types;
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

        const rawClients = Array.isArray(rec.clients) ? rec.clients : [];
        const clients: ClientEntity[] = [];
        for (const item of rawClients) {
            const c = item as Record<string, unknown>;
            if (!c || typeof c.id !== "string" || c.id.length === 0 || typeof c.name !== "string") continue;
            clients.push({ id: c.id, name: c.name });
        }

        const rawProjects = Array.isArray(rec.projects) ? rec.projects : [];
        const projects: ProjectEntity[] = [];
        for (const item of rawProjects) {
            const p = item as Record<string, unknown>;
            if (!p || typeof p.id !== "string" || p.id.length === 0
                || typeof p.name !== "string" || typeof p.client_id !== "string" || p.client_id.length === 0) continue;
            projects.push({ id: p.id, name: p.name, client_id: p.client_id });
        }

        const rawTaskTypes = Array.isArray(rec.task_types) ? rec.task_types : [];
        const task_types: TaskTypeEntity[] = [];
        for (const item of rawTaskTypes) {
            const t = item as Record<string, unknown>;
            if (!t || typeof t.id !== "string" || t.id.length === 0 || typeof t.name !== "string") continue;
            const entity: TaskTypeEntity = { id: t.id, name: t.name };
            if (Array.isArray(t.aliases)) {
                const aliases = t.aliases.filter((a): a is string => typeof a === "string");
                if (aliases.length > 0) entity.aliases = aliases;
            }
            task_types.push(entity);
        }

        return new Registry(repos, declined, clients, projects, task_types);
    }

    get repos(): RepoEntry[] {
        return this._repos.slice();
    }

    get declined_paths(): string[] {
        return this._declined.slice();
    }

    get clients(): ClientEntity[] {
        return this._clients.map(c => ({ ...c }));
    }

    get projects(): ProjectEntity[] {
        return this._projects.map(p => ({ ...p }));
    }

    get task_types(): TaskTypeEntity[] {
        return this._task_types.map(t => (t.aliases ? { ...t, aliases: t.aliases.slice() } : { ...t }));
    }

    find_client_by_id(id: string): ClientEntity | undefined {
        return this._clients.find(c => c.id === id);
    }

    find_project_by_id(id: string): ProjectEntity | undefined {
        return this._projects.find(p => p.id === id);
    }

    find_task_type_by_id(id: string): TaskTypeEntity | undefined {
        return this._task_types.find(t => t.id === id);
    }

    /** Add the client, or replace the existing entry with the same id. Returns a new Registry. */
    upsert_client(entry: ClientEntity): Registry {
        const next = this._clients.filter(c => c.id !== entry.id);
        next.push({ ...entry });
        return new Registry(this._repos.slice(), this._declined.slice(), next, this._projects.slice(), this._task_types.slice());
    }

    /** Add the project, or replace the existing entry with the same id. Returns a new Registry. */
    upsert_project(entry: ProjectEntity): Registry {
        const next = this._projects.filter(p => p.id !== entry.id);
        next.push({ ...entry });
        return new Registry(this._repos.slice(), this._declined.slice(), this._clients.slice(), next, this._task_types.slice());
    }

    /** Add the task-type, or replace the existing entry with the same id. Returns a new Registry. */
    upsert_task_type(entry: TaskTypeEntity): Registry {
        const next = this._task_types.filter(t => t.id !== entry.id);
        next.push({ ...entry, aliases: entry.aliases ? entry.aliases.slice() : undefined });
        return new Registry(this._repos.slice(), this._declined.slice(), this._clients.slice(), this._projects.slice(), next);
    }

    /**
     * Adopt a legacy job_id as an alias on an existing task-type (idempotent — no
     * duplicate aliases). No-op (returns `this`) when the task-type id is unknown, the
     * same tolerant style as the other loaders.
     */
    add_task_type_alias(task_type_id: string, alias: string): Registry {
        const existing = this._task_types.find(t => t.id === task_type_id);
        if (!existing) return this;
        const aliases = existing.aliases ?? [];
        if (aliases.includes(alias)) return this;
        const updated: TaskTypeEntity = { ...existing, aliases: [...aliases, alias] };
        const next = this._task_types.map(t => (t.id === task_type_id ? updated : t));
        return new Registry(this._repos.slice(), this._declined.slice(), this._clients.slice(), this._projects.slice(), next);
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
        return new Registry(next, this._declined.slice(), this._clients.slice(), this._projects.slice(), this._task_types.slice());
    }

    /** True when the folder was declined ("Never for this folder"). Path-normalized. */
    is_declined(p: string): boolean {
        const target = normalize_path(p);
        return this._declined.some(d => normalize_path(d) === target);
    }

    /** Record a declined folder (no-op if already present). Returns a new Registry. */
    add_declined(p: string): Registry {
        if (this.is_declined(p)) return this;
        return new Registry(this._repos.slice(), [...this._declined, p], this._clients.slice(), this._projects.slice(), this._task_types.slice());
    }

    /** Clear a folder's decline — the underlying reverse of opt-out (UI is #6). */
    remove_declined(p: string): Registry {
        const target = normalize_path(p);
        return new Registry(this._repos.slice(), this._declined.filter(d => normalize_path(d) !== target), this._clients.slice(), this._projects.slice(), this._task_types.slice());
    }

    to_dto(): RegistryDTO {
        return {
            format_version: REGISTRY_FORMAT_VERSION,
            repos: this._repos.map(r => ({ ...r })),
            declined: this._declined.slice(),
            clients: this._clients.map(c => ({ ...c })),
            projects: this._projects.map(p => ({ ...p })),
            task_types: this._task_types.map(t => (t.aliases ? { ...t, aliases: t.aliases.slice() } : { ...t })),
        };
    }
}
