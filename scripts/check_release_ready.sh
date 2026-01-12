#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# develop → main release readiness check
# ============================================================
# This script enforces release hygiene before merging develop
# into main. It ensures:
#
# 1. Save all files before running this script.
#    (Unsaved changes are not visible to Git.)
#
# 2. Working tree must be clean
# 3. develop must be up to date with origin/main
# 4. Version number must be bumped relative to main
# 5. Lint must pass
# 6. Tests must pass
# 7. TypeScript must compile
# 8. vscode:prepublish must succeed
# 9. vsce package must succeed
# 10. The .vsix artifact must exist
# 11. No dependency changes unless explicitly intended
#
# Output is intentionally quiet:
# - Only high-level ✓ / FAIL lines are printed
# - All underlying commands run silently
#
# Usage:
#   npm run check:release
# ============================================================


# ============================================================
# 1. Ensure working tree is clean
# ============================================================
if [ -n "$(git status --porcelain)" ]; then
  echo "FAIL: Working tree is not clean"
  exit 1
fi
echo "✓ Working tree is clean"

# Save confirmation prompt
read -r -p "Did you save all files before running this script? [y/n] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Exiting so you can save your files."
  exit 1
fi


# ============================================================
# 2. Ensure develop is up to date with main
# ============================================================
git fetch origin main >/dev/null 2>&1

if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "FAIL: develop is not up to date with origin/main"
  exit 1
fi
echo "✓ develop is up to date with main"


# ============================================================
# 3.0 Version bump check
# ============================================================
DEV_VERSION=$(jq -r '.version' package.json)
MAIN_VERSION=$(git show origin/main:package.json | jq -r '.version')

if [ "$DEV_VERSION" = "$MAIN_VERSION" ]; then
  echo "FAIL: Version number has not been bumped (still $DEV_VERSION)"
  exit 1
fi

# Optional: ensure semver ordering
if ! printf "%s\n%s" "$MAIN_VERSION" "$DEV_VERSION" | sort -V | tail -n1 | grep -q "$DEV_VERSION"; then
  echo "FAIL: Version $DEV_VERSION is not greater than $MAIN_VERSION"
  exit 1
fi

echo "✓ Version bumped: $MAIN_VERSION → $DEV_VERSION"

# ============================================================
# 3.1 Ensure no existing tag already uses this version
# ============================================================
if git rev-parse "v$DEV_VERSION" >/dev/null 2>&1; then
  echo "FAIL: Tag v$DEV_VERSION already exists"
  echo "Choose a new version number before releasing."
  exit 1
fi

echo "✓ No existing tag for v$DEV_VERSION"


# ============================================================
# 4. Lint, tests, compile (quiet mode)
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
# 5. Prepublish build
# ============================================================
if ! npm run vscode:prepublish --silent >/dev/null 2>&1; then
  echo "FAIL: vscode:prepublish failed"
  exit 1
fi
echo "✓ Prepublish build succeeded"


# ============================================================
# 6. Clean old artifacts and run vsce package
# ============================================================
rm -f *.vsix
echo "✓ Removed old .vsix files"

if ! npx vsce package --no-dependencies --silent >/dev/null 2>&1; then
  echo "FAIL: vsce package failed"
  exit 1
fi
echo "✓ vsce package succeeded"


# ============================================================
# 7. Verify .vsix artifact exists for the correct version
# ============================================================
EXPECTED_VSIX="timescope-$DEV_VERSION.vsix"

if [ ! -f "$EXPECTED_VSIX" ]; then
  echo "FAIL: Expected .vsix file not found: $EXPECTED_VSIX"
  echo "Make sure vsce packaged the extension with the correct version."
  exit 1
fi

echo "✓ .vsix artifact found: $EXPECTED_VSIX"


# ============================================================
# 8. Ensure no dependency changes
# ============================================================
if git diff origin/main package.json | grep -q '"dependencies"'; then
  echo "FAIL: dependencies changed relative to main"
  exit 1
fi

if git diff origin/main package.json | grep -q '"devDependencies"'; then
  echo "FAIL: devDependencies changed relative to main"
  exit 1
fi

echo "✓ No dependency changes"


# ============================================================
# Final success banner
# ============================================================
echo "----------------------------------------"
echo "✓ develop is ready to merge into main"
echo "----------------------------------------"