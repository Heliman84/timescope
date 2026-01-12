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

# Ensure jq is installed
if ! command -v jq >/dev/null 2>&1; then
    echo "FAIL: 'jq' is required but not installed or not found in PATH."
    echo "Please install jq (https://stedolan.github.io/jq/) and try again."
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

# Derive repository URL from the git origin remote
REPO_URL="$(git config --get remote.origin.url)"

# Normalize common GitHub URL formats to https://github.com/owner/repo
if [[ "$REPO_URL" =~ ^git@github.com:(.*)\.git$ ]]; then
    REPO_PATH="${BASH_REMATCH[1]}"
    REPO_URL="https://github.com/$REPO_PATH"
elif [[ "$REPO_URL" =~ ^https://github.com/(.*)\.git$ ]]; then
    REPO_PATH="${BASH_REMATCH[1]}"
    REPO_URL="https://github.com/$REPO_PATH"
fi

# Ensure no trailing slash before appending /releases
REPO_URL="${REPO_URL%/}"
open "$REPO_URL/releases/new?tag=$TAG"

echo ""
echo "Next steps:"
echo "1. Upload the .vsix file as a release asset"
echo "2. Publish the release"
echo ""