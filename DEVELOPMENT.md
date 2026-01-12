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

OR

Use the GitHub CLI to login. Then run

```bash
$env:GITHUB_TOKEN = (gh auth token)
```

Security notes:

- Secrets are encrypted and stored by GitHub; their *values are not visible* to people viewing the repository. Only users with repo admin permissions can add or remove secrets; even they cannot read the secret value after it is saved.
- In Actions logs, secrets are masked and will not be printed. Avoid echoing secrets in workflow steps.
- Locally, the release script uses `GITHUB_TOKEN` or `GH_TOKEN` environment variables when calling the Actions dispatch API. When running workflows in Actions, the `GH_PAT` repo secret will be preferred by the workflow for operations that require elevated permissions.

## Notes & troubleshooting

** this section needs updating - a release workflow has been added **

- If your repo enforces branch protection rules (e.g., required reviews), automated merges may fail; in that case use a manual PR flow or add a PAT with the required permission and make sure branch protection allows the automation to merge.
- If the workflow fails during the README check, update `README.md` on the branch to include the user-facing changes and re-run the workflow.
- Status bar ordering: task-button extensions may add buttons at priority ~100. To keep TimeScope buttons to the left, edit the numeric priorities in `src/extension.ts` (they start at 300 and decrement).


## 🧭 Development‑Mode Roadmap (Internal Only)

This section outlines planned developer‑only features that improve safety, ergonomics, and workflow consistency when working on TimeScope itself.

### 1. Handle global storage directory in dev mode

This feature will add detection of when we are in dev mode to automatically handle some safe changes of state like the global storage directory (to start).

#### 1.1 Development Mode Detection (`in_dev.json`)

We plan to introduce a lightweight mechanism for TimeScope to detect when the extension is being used in **development mode**.

- A file named `in_dev.json` will be placed inside the user’s `.timescope/` directory.
- The presence of this file signals that the user is actively developing TimeScope.
- When present, TimeScope will perform additional checks and show developer‑only notifications.

#### 1.2 Global Storage Directory Safety Checks

When `in_dev.json` exists:

- TimeScope will verify that the configured `timescope.global_storage_dir` **ends with `\test`**.
- If it does **not**, TimeScope will show a small notification reminding the developer that they are **not using the test global directory**, prompting them to switch.

When `in_dev.json` does **not** exist:

- TimeScope will verify that the global storage directory **does not** end with `\test`.
- If it *does*, TimeScope will notify the user that they are accidentally using the **test** directory in normal operation.

This ensures developers never accidentally write real jobs/logs into the test directory, and non‑developers never accidentally use the test directory.

#### 1.3 Developer Identity Setting

We will add a developer‑only setting (likely stored in the global jobs folder) that:

- Indicates the user is a TimeScope developer  
- Enables the dev‑mode checks described above  
- Allows us to gate future developer‑only features (debug panels, verbose logging, etc.)

This setting will not be exposed to normal users.

#### 1.4 Future Enhancements (Planned)

- Automatic creation of `in_dev.json` when running `feature_start.sh`
- Automatic removal of `in_dev.json` when running `release_start.sh`
- Optional VS Code status bar indicator showing whether TimeScope is in dev mode
- Optional command palette actions:
  - “Enable Development Mode”
  - “Disable Development Mode”
  - “Switch Global Storage Directory to Test”
  - “Switch Global Storage Directory to Production”
