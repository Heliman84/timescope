import * as vscode from "vscode";
import { Runtime } from "../core/runtime";
import { ClientEntity, ProjectEntity, Registry, mint_client_id, mint_project_id } from "../core/registry";

const NEW_CLIENT_SENTINEL = "__new_client__";
const NEW_PROJECT_SENTINEL = "__new_project__";

async function pick_or_create_client(registry: Registry): Promise<ClientEntity | null> {
    const clients = registry.clients;
    const items: vscode.QuickPickItem[] = [{ label: "$(add) New Client…", description: NEW_CLIENT_SENTINEL }];
    if (clients.length > 0) {
        items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
        items.push(...clients.map(c => ({ label: c.name, description: c.id })));
    }
    const picked = await vscode.window.showQuickPick(items, { placeHolder: "Select a Client" });
    if (!picked) return null;

    if (picked.description === NEW_CLIENT_SENTINEL) {
        const name = await vscode.window.showInputBox({ prompt: "Enter Client name" });
        if (!name || !name.trim()) return null;
        const trimmed = name.trim();
        const existing = clients.find(c => c.name === trimmed);
        if (existing) return existing;
        return { id: mint_client_id(registry, trimmed), name: trimmed };
    }

    return clients.find(c => c.id === picked.description) ?? null;
}

async function pick_or_create_project(registry: Registry, client: ClientEntity): Promise<ProjectEntity | null> {
    const projects = registry.projects.filter(p => p.client_id === client.id);
    const items: vscode.QuickPickItem[] = [{ label: "$(add) New Project…", description: NEW_PROJECT_SENTINEL }];
    if (projects.length > 0) {
        items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
        items.push(...projects.map(p => ({ label: p.name, description: p.id })));
    }
    const picked = await vscode.window.showQuickPick(items, { placeHolder: `Select a Project for ${client.name}` });
    if (!picked) return null;

    if (picked.description === NEW_PROJECT_SENTINEL) {
        const name = await vscode.window.showInputBox({ prompt: "Enter Project name" });
        if (!name || !name.trim()) return null;
        const trimmed = name.trim();
        const existing = projects.find(p => p.name === trimmed);
        if (existing) return existing;
        return { id: mint_project_id(registry, client.id, trimmed), name: trimmed, client_id: client.id };
    }

    return projects.find(p => p.id === picked.description) ?? null;
}

/**
 * Ensure the current opted-in repo has a Client/Project binding (#15 strict binding).
 * No-op (returns true immediately) when already bound. Otherwise walks pick-or-create
 * Client then pick-or-create Project (scoped to that client), persisting any newly
 * created entities to the registry and the binding to `.timescope/config.json`.
 * Cancellable at every step — cancelling (Esc) aborts without changing anything.
 * Returns false when the user cancelled.
 */
export async function ensure_repo_binding(runtime: Runtime): Promise<boolean> {
    if (runtime.repoBinding) return true;
    if (!runtime.repoConfig) {
        // Defensive: refresh in case the caller just enabled local logging.
        runtime.refreshRepoJobs();
    }
    if (!runtime.repoConfig) return false; // not actually opted in — nothing to bind

    let registry = runtime.registryRepo.load();

    const client = await pick_or_create_client(registry);
    if (!client) return false;
    if (!registry.find_client_by_id(client.id)) {
        registry = registry.upsert_client(client);
    }

    const project = await pick_or_create_project(registry, client);
    if (!project) return false;
    if (!registry.find_project_by_id(project.id)) {
        registry = registry.upsert_project(project);
    }

    runtime.registryRepo.save(registry);
    runtime.persistRepoConfig({ ...runtime.repoConfig, binding: { client_id: client.id, project_id: project.id } });
    return true;
}
