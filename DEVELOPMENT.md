# Developer Guide — TimeScope

This document contains developer-facing instructions: building, testing, release automation, and how to configure repository secrets.

## Building & Testing

- Install dependencies: `npm install`
- Compile: `npm run compile`
- Run tests: `npm test`
- Run extension in dev: Press F5 in VS Code (launches an Extension Development Host)

## File structure

- `src/` — TypeScript source
- `src/dashboard/webview` — dashboard UI files included in the extension package
- `out/` — compiled JS output (packaged into the VSIX)

## Release flow (local + GitHub Actions)

We provide a one-command local helper to dispatch the release workflow and create a draft GitHub Release with an attached `.vsix` file.

- Local trigger: `npm run release:visx` (runs `scripts/release-visx.js`)

What `release:visx` enforces locally before dispatching the workflow:

- Your working tree must be clean (no uncommitted changes). The script will fail if `git status --porcelain` returns any output.
- Your branch must have an upstream and be up-to-date (push any local commits first).

The workflow will:
1. Run the test suite (`npm test`).
2. Build the extension (`npm run vscode:prepublish`).
3. Verify `README.md` was updated to reflect the feature/roadmap changes.
4. Merge the specified branch into `main`.
5. Bump the `package.json` version using `npm version` and create a `vX.Y.Z` tag.
6. Package a `.vsix` with `vsce` and create a draft GitHub Release with the VSIX attached.

> The release is created as a *draft* so you can install it locally and test across machines before publishing to the Marketplace.

### Semver bump selection

When dispatching the workflow you will be asked to pick one of: `major`, `minor`, or `patch`. This determines how `npm version` increments `package.json`.

### Single source of truth for version

`package.json` is the authoritative version for the extension and is the only file we update during releases. Avoid hard-coding version strings elsewhere in the repo so the workflow only needs to update one place.

## Repository secrets & tokens

You will need to create a Personal Access Token (PAT) with `repo` scope to allow the workflow to push and tag the repository when branch protection is enabled. We recommend storing the PAT as a repository secret called `GH_PAT`.

How to add a secret in GitHub:
1. Open your repository on GitHub.
2. Click `Settings` → `Secrets and variables` → `Actions` → `New repository secret`.
3. Name the secret `GH_PAT` and paste the token value.

Security notes:
- Secrets are encrypted and stored by GitHub; their _values are not visible_ to people viewing the repository. Only users with repo admin permissions can add or remove secrets; even they cannot read the secret value after it is saved.
- In Actions logs, secrets are masked and will not be printed. Avoid echoing secrets in workflow steps.
- Locally, the release script uses `GITHUB_TOKEN` or `GH_TOKEN` environment variables when calling the Actions dispatch API. When running workflows in Actions, the `GH_PAT` repo secret will be preferred by the workflow for operations that require elevated permissions.

## Notes & troubleshooting

- If your repo enforces branch protection rules (e.g., required reviews), automated merges may fail; in that case use a manual PR flow or add a PAT with the required permission and make sure branch protection allows the automation to merge.
- If the workflow fails during the README check, update `README.md` on the branch to include the user-facing changes and re-run the workflow.
- Status bar ordering: task-button extensions may add buttons at priority ~100. To keep TimeScope buttons to the left, edit the numeric priorities in `src/extension.ts` (they start at 300 and decrement). 

## Workspace button (quick-access)

To add a persistent, visible **Release** button in the status bar for this workspace only, use the **Task Buttons** extension (`spencerwmiles.vscode-task-buttons`). This approach is workspace-local when you enable the extension for this repository.

Steps:

1. Install **Task Buttons** (`spencerwmiles.vscode-task-buttons`) and **Enable (Workspace)** from the Extensions view so the button only appears for this repo.
2. Open the Task Buttons view (or its extension UI) and locate the task named exactly `Release VSIX (Save All + Dispatch)`.
3. Use the Task Buttons UI to **add/pin** the `Release VSIX (Save All + Dispatch)` task as a status-bar button.

Notes & troubleshooting:

- The task label must match the label in `.vscode/tasks.json` exactly.
- If the button does not appear, reload the window (Developer: Reload Window) or open the Task Buttons UI and re-add the task.
- If you prefer, you can also add a workspace keybinding as a fallback.

---

If you'd like, I can add a small workspace configuration that suggests Task Buttons and optionally add a workspace keybinding as a fallback. Let me know and I’ll apply those changes.
---

If you'd like, I can also add a workspace keybinding as a fallback and a short reminder in the README so the button isn't forgotten. Let me know which extras you'd like.