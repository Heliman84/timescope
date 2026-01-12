#!/usr/bin/env bash
set -euo pipefail

# Ensure we are on develop
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "develop" ]; then
    echo "FAIL: feature:start must be run from the develop branch"
    echo "Current branch: $CURRENT_BRANCH"
    exit 1
fi

# Ask for feature name
read -r -p "Feature name: " FEATURE_NAME

# Convert to slug (lowercase, hyphens, no extra spaces)
SLUG=$(echo "$FEATURE_NAME" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')

BRANCH="feature/$SLUG"
PLAN_FILE="pr/$SLUG.md"
TEMPLATE="pr/01_pr_feature_template.md"

echo "Creating branch: $BRANCH"
git checkout -b "$BRANCH"

echo "Creating plan file: $PLAN_FILE"
cp "$TEMPLATE" "$PLAN_FILE"

# Replace placeholders in YAML + title
sed -i '' "s/<FEATURE_NAME>/$SLUG/g" "$PLAN_FILE"
sed -i '' "s/<FEATURE-NAME>/$SLUG/g" "$PLAN_FILE"

echo "Opening plan file..."
code "$PLAN_FILE"

echo ""
echo "✓ Feature branch created"
echo "✓ Plan file created"
echo ""
echo "Next steps:"
echo "1. Fill out Summary and User-Facing Behavior"
echo "2. Let the agent generate the Implementation Plan"
echo "3. Run: npm run feature:finish"