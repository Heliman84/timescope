import * as vscode from "vscode";
import { Runtime } from "../core/runtime";
import { TaskTypeEntity } from "../core/registry";
import { resolve_task_type, convert_legacy_job } from "../core/task_types";
import { compute_seeded_id } from "../core/id_gen";

const NEW_TASK_TYPE_SENTINEL = "__new_task_type__";
const OTHER_SENTINEL = "__other__";

/**
 * Pick an existing task-type from `candidates`, or create a new one (persisted to the
 * registry immediately). `suggested_name` prefills the "new" input box (used when
 * converting a legacy job — the legacy title is a natural default). Returns null on
 * cancel at any step.
 */
async function pick_or_create_task_type(
    runtime: Runtime,
    candidates: TaskTypeEntity[],
    opts: { placeHolder: string; suggested_name?: string }
): Promise<TaskTypeEntity | null> {
    const items: vscode.QuickPickItem[] = [{ label: "$(add) New Task-type…", description: NEW_TASK_TYPE_SENTINEL }];
    if (candidates.length > 0) {
        items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
        items.push(...candidates.map(t => ({ label: t.name, description: t.id })));
    }
    const picked = await vscode.window.showQuickPick(items, { placeHolder: opts.placeHolder });
    if (!picked) return null;

    if (picked.description === NEW_TASK_TYPE_SENTINEL) {
        const name = await vscode.window.showInputBox({ prompt: "Enter Task-type name", value: opts.suggested_name });
        if (!name || !name.trim()) return null;
        const trimmed = name.trim();
        const registry = runtime.registryRepo.load();
        const existing = registry.task_types.find(t => t.name === trimmed);
        if (existing) return existing;
        const created: TaskTypeEntity = { id: compute_seeded_id(trimmed), name: trimmed };
        runtime.registryRepo.save(registry.upsert_task_type(created));
        return created;
    }

    return candidates.find(t => t.id === picked.description) ?? null;
}

/**
 * The Start command's task-type picker (#15). Sections: sentinels ("New Task-type…",
 * "Other…") first, then this repo's pinned/global task-type vocabulary, then legacy
 * flat jobs (from `pickableJobs()`) marked as legacy. Picking "New Task-type…" creates
 * and auto-pins (when a repo config exists). "Other…" opens the full global vocabulary
 * without auto-pinning. Picking a legacy job walks a conversion into a task-type
 * (adopts the legacy job_id as an alias, pins the target when a repo config exists).
 * Returns null on cancel at any step — nothing changes.
 */
export async function pick_task_type(runtime: Runtime): Promise<TaskTypeEntity | null> {
    const registry = runtime.registryRepo.load();
    const main_list = runtime.pickableTaskTypes();
    const legacy_jobs = runtime.pickableJobs().toArray()
        .filter(j => !resolve_task_type(registry, j.id));

    const items: (vscode.QuickPickItem & { _job_id?: string; _task_type_id?: string })[] = [
        { label: "$(add) New Task-type…", description: NEW_TASK_TYPE_SENTINEL },
        { label: "$(list-flat) Other…", description: OTHER_SENTINEL },
    ];
    if (main_list.length > 0) {
        items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
        items.push(...main_list.map(t => ({ label: t.name, description: t.id, _task_type_id: t.id })));
    }
    if (legacy_jobs.length > 0) {
        items.push({ label: "", kind: vscode.QuickPickItemKind.Separator, });
        items.push(...legacy_jobs.map(j => ({ label: `${j.title} (legacy)`, description: j.id, _job_id: j.id })));
    }

    const picked = await vscode.window.showQuickPick(items, { placeHolder: "Select a Task-type to start" });
    if (!picked) return null;

    if (picked.description === NEW_TASK_TYPE_SENTINEL) {
        const created = await pick_or_create_task_type(runtime, [], { placeHolder: "Name the new Task-type" });
        if (!created) return null;
        if (runtime.repoConfig) {
            const pinned = runtime.repoConfig.pinned_task_types ?? [];
            if (!pinned.includes(created.id)) {
                runtime.persistRepoConfig({ ...runtime.repoConfig, pinned_task_types: [...pinned, created.id] });
            }
        }
        return created;
    }

    if (picked.description === OTHER_SENTINEL) {
        const full_vocab = runtime.registryRepo.load().task_types;
        return pick_or_create_task_type(runtime, full_vocab, { placeHolder: "Select from the full Task-type vocabulary" });
    }

    if (picked._task_type_id) {
        return main_list.find(t => t.id === picked._task_type_id) ?? null;
    }

    if (picked._job_id) {
        const legacy_job = legacy_jobs.find(j => j.id === picked._job_id);
        if (!legacy_job) return null;

        const confirm = await vscode.window.showInformationMessage(
            `Convert legacy job "${legacy_job.title}" into a Task-type? Future sessions under this job will start under the Task-type instead.`,
            { modal: true },
            "Convert"
        );
        if (confirm !== "Convert") return null;

        const target = await pick_or_create_task_type(runtime, registry.task_types, {
            placeHolder: `Select or create the Task-type "${legacy_job.title}" converts into`,
            suggested_name: legacy_job.title,
        });
        if (!target) return null;

        const converted = convert_legacy_job(runtime.registryRepo.load(), runtime.repoConfig ?? {
            repo_id: "", format_version: 2,
        }, legacy_job.id, target.id);
        runtime.registryRepo.save(converted.registry);
        if (runtime.repoConfig) {
            runtime.persistRepoConfig(converted.config);
        }
        return target;
    }

    return null;
}
