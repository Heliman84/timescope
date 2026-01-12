#!/usr/bin/env bash
set -euo pipefail

# Ensure we are on develop
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "develop" ]; then
    echo "FAIL: release:start must be run from the develop branch"
    echo "Current branch: $CURRENT_BRANCH"
    exit 1
fi

# Run release checks
npm run check:release

echo "✓ Release checks passed"

# Open PR creation page for develop → main
REPO_URL=$(git config --get remote.origin.url | sed 's/\.git$//')
open "$REPO_URL/compare/main...develop?expand=1"

echo ""
echo "✓ Opening release PR creation page"
echo "Review the diff carefully, then submit the PR."