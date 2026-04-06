import * as vscode from "vscode";
import { JobCollection } from "../core/job_collection";
import { Job } from "../core/job";
import { JobRepository } from "../core/job_repository";

const NEW_JOB_SENTINEL = "create-new";

export async function pickJob(
  jobs: JobCollection,
  opts?: { placeHolder?: string; includeNewJob?: boolean; jobRepo?: JobRepository }
): Promise<Job | null> {
  const arr = jobs.toArray();

  if (opts?.includeNewJob && !opts.jobRepo) {
    throw new Error("pickJob: jobRepo is required when includeNewJob is true");
  }

  if (arr.length === 0 && !opts?.includeNewJob) return null;

  const items: vscode.QuickPickItem[] = [];

  if (opts?.includeNewJob) {
    items.push({ label: "$(add) New Job...", description: NEW_JOB_SENTINEL });
    if (arr.length > 0) {
      items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
    }
  }

  items.push(...arr.map(j => ({ label: j.title, description: j.id })));

  const picked = await vscode.window.showQuickPick(items, { placeHolder: opts?.placeHolder ?? "Select a job" });
  if (!picked) return null;

  if (picked.description === NEW_JOB_SENTINEL) {
    const name = await vscode.window.showInputBox({ prompt: "Enter job name" });
    if (!name) return null;
    const created = Job.create({ title: name });
    await opts!.jobRepo!.save(created);
    return created;
  }

  const job = arr.find(j => j.id === picked.description);
  return job ?? null;
}
