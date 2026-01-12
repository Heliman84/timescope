#!/usr/bin/env bash
set -euo pipefail

# Ensure we are on main
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "FAIL: release:publish must be run from the main branch"
    echo "Current branch: $CURRENT_BRANCH"
    exit 1
fi

# Ensure working tree is clean
if [ -n "$(git status --porcelain)" ]; then
    echo "FAIL: Working tree is not clean. Commit or stash changes first."
    exit 1
fi

# Extract version from package.json
VERSION=$(jq -r '.version' package.json)
TAG="v$VERSION"

echo "Preparing to publish release: $TAG"
read -r -p "Tag and push release $TAG ? (y/n): " ANSWER
if [ "$ANSWER" != "y" ]; then
    echo "Aborted."
    exit 0
fi

echo "Tagging release..."
git tag "$TAG"

echo "Pushing tag..."
git push origin "$TAG"

echo ""
echo "✓ Tag pushed: $TAG"
echo "Opening GitHub Releases page..."
echo ""

# Replace with your repo URL
REPO_URL="https://github.com/YOUR_USERNAME/TimeScope"
open "$REPO_URL/releases/new?tag=$TAG"

echo ""
echo "Next steps:"
echo "1. Upload the .vsix file as a release asset"
echo "2. Publish the release"
echo ""