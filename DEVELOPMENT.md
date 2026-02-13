# Developer Guide — TimeScope

This document describes how to develop, test, and release TimeScope.  
It includes the complete feature workflow, release workflow, and a reference for all development scripts.

---

## TimeScope Feature + Release Workflow (Command‑Inclusive Diagram)

                 ┌──────────────────────────────────────┐
                 │  1. Start on develop                 │
                 │   • Pull latest                      │
                 │   • Discuss with AI to understand    │   
                 │     new feature                      │
                 └───────────────────┬──────────────────┘
                                     │
                                     ▼
                 ┌──────────────────────────────────────┐
                 │ 2. Definition Phase                  │
                 │  GH PR extension flow:               │
                 │   • click Start working on issue     │
                 │   • creates feature/<issue>-<title>  │
                 │   • run: npm run feature:start-gh    │
                 │     - create spec file in /pr        │
                 │     - inject Issue link              │
                 │     - switch global dir → \test      │
                 │     - prompts if branch differs      │
                 │  Or (CLI flow):                      │
                 │   • run: npm run feature:start       │
                 │     - create feature/<slug> branch   │
                 │     - create spec file in /pr        │
                 │     - switch global dir → \test      │
                 │  Fill out feature spec (with AI)     │
                 └───────────────────┬──────────────────┘
                                     │
                                     ▼
                 ┌──────────────────────────────────────┐
                 │ 3. Consultation Phase                │
                 │  Copilot Agent: Planning mode        │
                 │   • Review spec                      │
                 │   • Identify gaps/risks              │
                 │   • No code changes                  │
                 └───────────────────┬──────────────────┘
                                     │
                                     ▼
                 ┌──────────────────────────────────────┐
                 │ 4. Implementation Planning           │
                 │  Copilot Agent: Planning mode        │
                 │   • Produce deterministic plan       │
                 │   • List exact files/tests           │
                 │   • No code changes                  │
                 └───────────────────┬──────────────────┘
                                     │
                                     ▼
                 ┌──────────────────────────────────────┐
                 │ 5. Execution Phase                   │
                 │  Copilot Agent: Agent mode           │
                 │   •  Apply plan exactly              │
                 │   •  Show diffs for approval         │
                 │  Developer tests locally             │
                 └───────────────────┬──────────────────┘
                                     │
                                     ▼
                 ┌──────────────────────────────────────┐
                 │ 6. PR → develop                      │
                 │  Copilot Agent: Planning mode        │
                 │   • generate PR description          │
                 │  Run: `npm run check:pr`             │
                 │  Create PR in GH PR extension     │
                 │  OR: `npm run feature:finish`        │
                 │   • run PR checks                    │
                 │   • open PR feature → develop        │
                 └───────────────────┬──────────────────┘
                                     │
                                     ▼
                         Merge PR: feature → develop
                                     │
                                     ▼
                 ┌──────────────────────────────────────┐
                 │ 7. Release (develop → main)          │
                 │  * Update version in package.json    │
                 │  Run: `npm run release:start`        │
                 │   • build .vsix                      │
                 │   • open PR develop → main           │
                 │   • prompt to remove \test from      │
                 │     global storage directory         │
                 └───────────────────┬──────────────────┘
                                     │
                                     ▼
                         Merge PR: develop → main
                                     │
                                     ▼
                 ┌──────────────────────────────────────┐
                 │ 8. Publish Release                   │
                 │  Run: `npm run release:publish`      │
                 │   • verify clean state               │
                 │   • tag vX.Y.Z                       │
                 │   • push tag                         │
                 │   • open GitHub Release page         │
                 │  Developer uploads .vsix             │
                 └───────────────────┬──────────────────┘
                                     │
                                     ▼
                 ┌──────────────────────────────────────┐
                 │ 9. Cleanup                           │
                 │   • Delete feature branch on GitHub  │
                 │   • Optionally delete local branch   │
                 │     `git branch -d feature/<FEATURE>`│
                 └──────────────────────────────────────┘

---


## Script Reference (from package.json)

### **Core Development Scripts**

#### `compile`
* Compiles TypeScript into `out/`.

#### `watch`
* Watches and recompiles on file changes.

#### `copy-dashboard`
* Copies dashboard webview assets into the compiled output folder.

#### `vscode:prepublish`
* Runs `compile` and `copy-dashboard`.  
* Used before packaging or publishing.

#### `test`
* Compiles and runs the extension test suite.

---

### **Feature Workflow Scripts**

#### `feature:start-gh`
* Prompts for feature/issue name  
* Creates spec file in `/pr`  
* Switches global storage directory → `\test`  
* Does not create or switch branches

#### `feature:start`
* Prompts for feature name  
* Creates `feature/<slug>` branch  
* Creates spec file in `/pr`  
* Switches global storage directory → `\test`

#### `feature:finish`
* Runs PR readiness checks  
* Opens PR from feature branch → `develop`

---

### **Release Workflow Scripts**

#### `release:start`
* Ensures version updated in `package.json`  
* Builds `.vsix`  
* Opens PR from `develop` → `main`  
* Prompts developer to remove `\test` from global storage directory

#### `release:publish`
* Ensures working tree is clean  
* Reads version from `package.json`  
* Creates tag `vX.Y.Z`  
* Pushes tag  
* Opens GitHub Release page for uploading `.vsix`

---


## Building & Testing

* Install dependencies:  
  `npm install`

* Compile:  
  `npm run compile`

* Run tests:  
  `npm test`

* Run extension in development mode:  
  Press **F5** in VS Code (launches an Extension Development Host)

---


## File Structure

* `src/` — TypeScript source  
* `src/dashboard/webview/` — dashboard UI files included in the extension package  
* `out/` — compiled JS output (packaged into the VSIX)  
* `pr/` — feature specifications  
* `scripts/` — workflow automation scripts  

---


## 🧭 Development‑Mode Roadmap (Internal Only)

This section outlines planned developer‑only features that improve safety, ergonomics, and workflow consistency when working on TimeScope itself.

### 1. Handle global storage directory in dev mode
This feature will add detection of when we are in dev mode to automatically handle some safe changes of state like the global storage directory (to start).

#### 1.1 Development Mode Detection (`in_dev.json`)
We plan to introduce a lightweight mechanism for TimeScope to detect when the extension is being used in **development mode**.

* A file named `in_dev.json` will be placed inside the user’s `.timescope/` directory.
* The presence of this file signals that the user is actively developing TimeScope.
* When present, TimeScope will perform additional checks and show developer‑only notifications.

#### 1.2 Global Storage Directory Safety Checks
When `in_dev.json` exists:

* TimeScope will verify that the configured `timescope.global_storage_dir` **ends with `\test`**.
* If it does **not**, TimeScope will show a small notification reminding the developer that they are **not using the test global directory**, prompting them to switch.

When `in_dev.json` does **not** exist:

* TimeScope will verify that the global storage directory **does not** end with `\test`.
* If it *does*, TimeScope will notify the user that they are accidentally using the **test** directory in normal operation.

This ensures developers never accidentally write real jobs/logs into the test directory, and non‑developers never accidentally use the test directory.

#### 1.3 Developer Identity Setting
We will add a developer‑only setting (likely stored in the global jobs folder) that:

* Indicates the user is a TimeScope developer  
* Enables the dev‑mode checks described above  
* Allows us to gate future developer‑only features (debug panels, verbose logging, etc.)

This setting will not be exposed to normal users.

#### 1.4 Future Enhancements (Planned)
* Automatic creation of `in_dev.json` when running `feature_start.sh`
* Automatic removal of `in_dev.json` when running `release_start.sh`
* Optional VS Code status bar indicator showing whether TimeScope is in dev mode
* Optional command palette actions:
  * “Enable Development Mode”
  * “Disable Development Mode”
  * “Switch Global Storage Directory to Test”
  * “Switch Global Storage Directory to Production”