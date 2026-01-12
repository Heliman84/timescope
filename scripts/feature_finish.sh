#!/usr/bin/env bash
set -euo pipefail

# Ensure we are on a feature branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != feature/* ]]; then
  echo "FAIL: feature:finish must be run from a feature/* branch"
  echo "Current branch: $CURRENT_BRANCH"
  exit 1
fi


echo "Running PR checks..."
npm run check:pr

echo "✓ PR checks passed"

# Determine current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Determine repo URL (handles SSH or HTTPS remotes)
REPO_URL=$(git config --get remote.origin.url | sed 's/\.git$//')

# macOS: open browser
if command -v open >/dev/null 2>&1; then
  open "$REPO_URL/compare/develop...$BRANCH?expand=1"
# Linux: xdg-open
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$REPO_URL/compare/develop...$BRANCH?expand=1"
else
  echo "Open this URL to create the PR:"
  echo "$REPO_URL/compare/develop...$BRANCH?expand=1"
fi

echo ""
echo "✓ Opening PR creation page"
echo "Review the diff, fill out the PR description, and submit."