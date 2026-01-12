# TimeScope Feature Workflow (Reference)

## 1. Start on `develop`

* Pull latest.
* Create a new spec file based on [`/pr/01_pr_feature_template.md`](./01_pr_feature_template.md).

## 2. Definition Phase - Write the PR spec

* Talk to MS Copliot 365 conversationally to help draft the spec (using template).
* Run command in terminal: `npm run feature:start`
  * This will prompt for the feature name and create a new branch off `develop`.
  * It will also create a slugified markdown file in `/pr/` for the feature spec.
* Fill out [`/pr/01_pr_feature_template.md`](./01_pr_feature_template.md) for the new feature.

## 3. Consultation Phase - Copilot Agent: Planning mode

```text
# ============================================
# Replace <FEATURE.md> before running
# Example: pr/soft-delete.md
# ============================================

Review <FEATURE.md> in detail.

Your task is to evaluate the specification thoroughly and identify anything
that is missing, unclear, risky, or architecturally significant. Do NOT modify
any code or create any files.

Provide feedback on:
• Missing requirements or ambiguities
• Edge cases the feature must handle
• Architectural impacts
• State machine implications
• Dashboard or webview implications
• Data model considerations
• Files that will need to be modified
• Files that must NOT be modified
• Any risks, constraints, or potential regressions
• Any questions you need answered before implementation

Do not propose an implementation plan yet.
Do not make any code changes.
Only analyze and improve the specification.
```

* Update the file if needed.

## 4. Plan Implementation Phase - Copilot Agent: Planning mode

```text
# ============================================
# Replace <FEATURE> and <FEATURE.md> before running
# Example: soft-delete   |   pr/soft-delete.md
# ============================================

Use <FEATURE.md> as the complete specification for this feature.

Create a new branch named feature/<FEATURE> off develop.
Do NOT modify any code yet.

Your task is to produce a detailed, step-by-step implementation plan that fully
satisfies the specification. The plan must include:

• All unit tests that must be created or updated, including exact test files and coverage expectations
• Exact files to modify
• Exact files to avoid
• All new files to create (if any)
• Required changes to the state machine
• Required changes to the dashboard or webview
• Required changes to commands, settings, or activation events
• Any data model or log format changes
• Any migration steps (if needed)
• A clear, ordered sequence of actions you will take
• Notes on potential risks or regressions

The plan must be explicit enough that you can execute it deterministically
without guessing.

Do not write or modify any code yet.
Only produce the implementation plan.
```

* Approve or refine.

## 5. Execution Phase - Copilot Agent: Agent mode

```text
# ============================================
# No placeholders to replace
# ============================================

Apply the implementation plan exactly as written.

Follow these rules strictly:
• Create or update unit tests exactly as specified in the implementation plan. Do not modify unrelated tests.
• Modify only the files listed in the plan.
• Do not modify any other files.
• Do not introduce new dependencies.
• Do not change package.json unless explicitly allowed.
• Do not refactor unrelated code.
• Keep changes minimal and scoped to the feature.
• Show diffs before applying each set of changes.
• Wait for approval before applying diffs.

If the plan needs to be adjusted, pause and ask before proceeding.
Do not guess or improvise beyond the approved plan.
```

* Review diffs carefully.
* Test the code locally.

## 6. PR → develop Phase - Copilot Agent: Planning mode

```text
# ============================================
# Replace <FEATURE.md> before running
# ============================================

Generate a clean, professional pull request description for this feature.

Include:
• Summary of the feature
• User-facing behavior
• Technical changes
• Files modified
• Any new files created
• State machine or dashboard changes
• Risks or considerations
• Confirmation that the implementation matches <FEATURE.md>

Format it in concise Markdown suitable for GitHub.
```

* once you have your PR description run command in terminal: `npm run feature:finish`
  * This will run PR checks and open a PR from your feature branch → develop.
* Merge after review.

## 7. Release (develop → main)

* **UPDATE VERSION NUMBER** in [`package.json`](../package.json) on `develop`.
* In terminal run `npm run release:start`.
* This should open a PR from `develop` → `main` in GitHub. **install the VSIX locally and test it before merging.**
  * To install the VSIX locally: `code --install-extension timescope-x.y.z.vsix`
* Merge develop → main.

To manually create and install the VSIX,
Run the release steps in main:

```bash
npm run vscode:prepublish
vsce package
code --install-extension timescope-x.y.z.vsix
vsce publish
```

## 8. Publish Release

Once the release PR is merged into `main`, the final step is publishing the versioned release.

This is done using:

```bash
npm run release:publish
```

This script:

* Ensures you are on the `main` branch  
* Ensures the working tree is clean  
* Reads the version from `package.json`  
* Creates a Git tag (`vX.Y.Z`)  
* Pushes the tag to GitHub  
* Opens the GitHub Releases page for that tag  

### Developer Action Required

After the script opens the Releases page:

1. Upload the generated `.vsix` file as a release asset  
2. Publish the release  

This is the official distribution mechanism for TimeScope builds.  
The `.vsix` file is intentionally **not** committed to the repository and is only attached to GitHub Releases.

## 9. Cleanup

* Delete the feature branch on GitHub (safe and reversible) by scrolling to bottom of PR page.
* Optionally delete the local branch:

```bash
git branch -d feature/<FEATURE>
