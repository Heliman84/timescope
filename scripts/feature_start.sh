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

###############################################
# Toggle TimeScope global storage directory
###############################################

case "$(uname -s)" in
    Darwin)
        SETTINGS_PATH="$HOME/Library/Application Support/Code/User/settings.json"
        ;;
    Linux)
        SETTINGS_PATH="$HOME/.config/Code/User/settings.json"
        ;;
    MINGW*|MSYS*|CYGWIN*)
        # On Windows, VS Code settings are typically under %APPDATA%\Code\User
        SETTINGS_PATH="${APPDATA:-$HOME/AppData/Roaming}/Code/User/settings.json"
        ;;
    *)
        echo "FAIL: Unsupported OS '$(uname -s)' for locating VS Code settings.json"
        exit 1
        ;;
esac

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
    # Remove \test
    NEW_VALUE="${CURRENT_VALUE%\\test}"
    echo "Switching TimeScope global storage to: $NEW_VALUE"
else
    # Add \test
    NEW_VALUE="${CURRENT_VALUE}\\test"
    echo "Switching TimeScope global storage to: $NEW_VALUE"
fi

# Escape backslashes for JSON
ESCAPED_VALUE=$(printf '%s\n' "$NEW_VALUE" | sed 's/\\/\\\\/g')

# Update settings.json
# (replace the entire line containing the setting)
sed -i '' "s|\"timescope.global_storage_dir\": *\"[^\"]*\"|\"timescope.global_storage_dir\": \"$ESCAPED_VALUE\"|" "$SETTINGS_PATH"

echo "✓ TimeScope global storage directory setting updated"
echo ""

###############################################


echo ""
echo "✓ Feature branch created"
echo "✓ Plan file created"
echo ""
echo "Next steps:"
echo "1. Fill out Summary and User-Facing Behavior"
echo "2. Let the agent generate the Implementation Plan"
echo "3. Run: npm run feature:finish"