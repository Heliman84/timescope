import * as vscode from "vscode";
import { JobCollection } from "../core/job_collection";
import { Job } from "../core/job";

export async function pickJob(jobs: JobCollection, opts?: { placeHolder?: string }): Promise<Job | null> {
  const arr = jobs.toArray();
  if (arr.length === 0) return null;

  const items: vscode.QuickPickItem[] = arr.map(j => ({ label: j.title, description: j.id }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: opts?.placeHolder ?? "Select a job" });
  if (!picked) return null;

  const job = arr.find(j => j.id === picked.description);
  return job ?? null;
}
