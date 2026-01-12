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

###############################################
# Remove /test from TimeScope global storage dir
###############################################

SETTINGS_PATH="$HOME/AppData/Roaming/Code/User/settings.json"

if [ ! -f "$SETTINGS_PATH" ]; then
    echo "FAIL: VS Code settings.json not found at:"
    echo "  $SETTINGS_PATH"
    exit 1
fi

CURRENT_VALUE=$(grep -o '"timescope.global_storage_dir": *"[^"]*"' "$SETTINGS_PATH" \
    | sed -E 's/.*"timescope.global_storage_dir": *"([^"]*)".*/\1/')

if [ -z "$CURRENT_VALUE" ]; then
    echo "FAIL: timescope.global_storage_dir is not set in settings.json"
    exit 1
fi

if echo "$CURRENT_VALUE" | grep -qi '\\test$'; then
    BASE_VALUE="${CURRENT_VALUE%\\test}"

    echo ""
    echo "Current TimeScope global storage directory:"
    echo "  $CURRENT_VALUE"
    echo ""
    read -r -p "Switch back to non-test directory? (y/n): " ANSWER

    if [ "$ANSWER" = "y" ]; then
        ESCAPED_VALUE=$(printf '%s\n' "$BASE_VALUE" | sed 's/\\/\\\\/g')
        if sed --version >/dev/null 2>&1; then
            sed -i "s|\"timescope.global_storage_dir\": *\"[^\"]*\"|\"timescope.global_storage_dir\": \"$ESCAPED_VALUE\"|" "$SETTINGS_PATH"
        else
            sed -i '' "s|\"timescope.global_storage_dir\": *\"[^\"]*\"|\"timescope.global_storage_dir\": \"$ESCAPED_VALUE\"|" "$SETTINGS_PATH"
        fi
        echo "✓ Switched to: $BASE_VALUE"
    else
        echo "Skipped switching global storage directory."
    fi
else
    echo "Global storage directory is already non-test."
fi

echo ""
###############################################
