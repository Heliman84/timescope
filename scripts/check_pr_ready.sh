#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# PR → develop readiness check
# ============================================================
# This script enforces your feature‑branch workflow rules:
#
# 1. Working tree must be clean
# 2. Branch must be up to date with origin/develop
# 3. Lint must pass
# 4. Tests must pass
# 5. TypeScript must compile
# 6. package.json changes must be explicitly authorized
# 7. No new dependencies may be added
# 8. Implementation plan must exist and be non‑empty
#
# Output is intentionally quiet:
# - Only high‑level ✓ / FAIL lines are printed
# - All underlying commands run silently
#
# Usage:
#   ./scripts/check_pr_ready.sh pr/<FEATURE>.md
# ============================================================

if [ $# -ne 1 ]; then
  echo "FAIL: No implementation plan file provided"
  exit 1
fi

PLAN_FILE="$1"

if [ ! -f "$PLAN_FILE" ]; then
  echo "FAIL: Implementation plan file not found: $PLAN_FILE"
  exit 1
fi

echo "Using implementation plan: $PLAN_FILE"


# ============================================================
# 0. Ensure no stray file changes (only files listed in plan may change)
# ============================================================

# Extract allowed files from YAML front-matter
ALLOWED_FILES=$(yq '.files_to_modify[]' "$PLAN_FILE")

# Get list of changed files in this branch
CHANGED_FILES=$(git diff --name-only origin/develop...HEAD)

# Check each changed file against the allow-list
for file in $CHANGED_FILES; do
  if ! grep -qx "$file" <<< "$ALLOWED_FILES"; then
    echo "FAIL: Stray file change detected: $file"
    echo "Only files listed under files_to_modify in the plan YAML may be changed."
    exit 1
  fi
done

echo "✓ No stray file changes"


# ============================================================
# 1. Ensure working tree is clean
# ============================================================
if [ -n "$(git status --porcelain)" ]; then
  echo "FAIL: Working tree is not clean"
  exit 1
fi
echo "✓ Working tree is clean"

# ============================================================
# Save confirmation prompt
# ============================================================
read -r -p "Did you save all files before running this script? [y/n] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Exiting so you can save your files."
  exit 1
fi


# ============================================================
# 2. Ensure branch is up to date with develop
# ============================================================
git fetch origin develop >/dev/null 2>&1

if ! git merge-base --is-ancestor origin/develop HEAD; then
  echo "FAIL: Branch is not up to date with origin/develop"
  exit 1
fi
echo "✓ Branch is up to date with develop"


# ============================================================
# 3. Lint, tests, and compile (quiet mode)
# ============================================================

# Lint
if ! npm run lint --silent >/dev/null 2>&1; then
  echo "FAIL: Lint failed"
  exit 1
fi
echo "✓ Lint succeeded"

# Tests
if ! npm test --silent >/dev/null 2>&1; then
  echo "FAIL: Tests failed"
  exit 1
fi
echo "✓ Tests succeeded"

# Compile
if ! npm run compile --silent >/dev/null 2>&1; then
  echo "FAIL: TypeScript compile failed"
  exit 1
fi
echo "✓ TypeScript compile succeeded"


# ============================================================
# 4. package.json change authorization
# ============================================================
if ! git diff --quiet origin/develop -- package.json; then
  echo "package.json has changes — checking authorization..."

  # Must be explicitly listed in the implementation plan
  if ! grep -qi "package.json" "$PLAN_FILE"; then
    echo "FAIL: package.json changed but is not listed in the implementation plan"
    exit 1
  fi

  echo "✓ package.json is listed in the implementation plan — allowed"
else
  echo "✓ package.json has no changes"
fi


# ============================================================
# 5. Ensure no new dependencies were added
# ============================================================
if git diff origin/develop package.json | grep -q '"dependencies"'; then
  echo "FAIL: dependencies changed"
  exit 1
fi

if git diff origin/develop package.json | grep -q '"devDependencies"'; then
  echo "FAIL: devDependencies changed"
  exit 1
fi

echo "✓ No new dependencies added"


# ============================================================
# 6. Ensure implementation plan is not empty
# ============================================================
if ! grep -q "[A-Za-z0-9]" "$PLAN_FILE"; then
  echo "FAIL: Implementation plan file is empty"
  exit 1
fi

echo "✓ Implementation plan exists and is non-empty"


# ============================================================
# Final success banner
# ============================================================
echo "----------------------------------------"
echo "✓ PR is ready for merge into develop"
echo "----------------------------------------"