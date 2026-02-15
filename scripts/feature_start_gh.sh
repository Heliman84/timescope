#!/usr/bin/env bash
set -euo pipefail

# Require running on a feature branch (GH PR extension should have created it)
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != feature/* ]]; then
    echo "FAIL: feature:start-gh must be run from a feature/* branch"
    echo "Current branch: $CURRENT_BRANCH"
    echo ""
    echo "Use the GitHub Pull Request extension to 'Start working on issue' first."
    exit 1
fi

ISSUE_NUMBER=""
ISSUE_TITLE=""

if [[ "$CURRENT_BRANCH" == feature/* ]]; then
    BRANCH_SUFFIX="${CURRENT_BRANCH#feature/}"
    # Handle formats: 123-title, issue123-title, issue123--title, etc.
    if [[ "$BRANCH_SUFFIX" =~ ^(issue)?([0-9]+)[-_]+([a-zA-Z0-9\-]+.*)$ ]]; then
        ISSUE_NUMBER="${BASH_REMATCH[2]}"
        ISSUE_TITLE="${BASH_REMATCH[3]}"
    elif [[ "$BRANCH_SUFFIX" =~ ^(issue)?([0-9]+)$ ]]; then
        ISSUE_NUMBER="${BASH_REMATCH[2]}"
    fi
fi

if [ -z "$ISSUE_NUMBER" ]; then
    read -r -p "Issue number: " ISSUE_NUMBER
fi

if [ -z "$ISSUE_TITLE" ]; then
    read -r -p "Issue title: " ISSUE_TITLE
fi

# Convert to slug (lowercase, hyphens, no extra spaces)
TITLE_SLUG=$(echo "$ISSUE_TITLE" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')

SLUG="${ISSUE_NUMBER}-${TITLE_SLUG}"
FEATURE_NAME="Issue ${ISSUE_NUMBER} - ${ISSUE_TITLE}"

PLAN_FILE="pr/$SLUG.md"
TEMPLATE="pr/01_pr_feature_template.md"

if [ -f "$PLAN_FILE" ]; then
    echo "FAIL: plan file already exists: $PLAN_FILE"
    exit 1
fi

echo "Creating plan file: $PLAN_FILE"
cp "$TEMPLATE" "$PLAN_FILE"

# Determine repo URL for Issue link
REMOTE_URL=$(git config --get remote.origin.url || true)
if [ -z "$REMOTE_URL" ]; then
    echo "FAIL: unable to read remote.origin.url"
    exit 1
fi

REPO_URL=$(printf '%s' "$REMOTE_URL" \
    | sed -E 's#^git@github.com:#https://github.com/#; s#^ssh://git@github.com/#https://github.com/#; s#^https?://github.com/#https://github.com/#; s#\.git$##')

ISSUE_URL="$REPO_URL/issues/$ISSUE_NUMBER"
ISSUE_LINK="[#${ISSUE_NUMBER}](${ISSUE_URL})"

ISSUE_BODY=""
if command -v gh >/dev/null 2>&1; then
    OWNER_REPO="${REPO_URL#https://github.com/}"
    ISSUE_BODY=$(gh api "repos/$OWNER_REPO/issues/$ISSUE_NUMBER" --jq ".body" 2>/dev/null || true)
fi

ISSUE_BODY=$(printf '%s' "$ISSUE_BODY" | sed -E 's/\r$//')

# Replace placeholders in YAML + title
sed -i '' "s/<FEATURE_NAME>/$FEATURE_NAME/g" "$PLAN_FILE"
sed -i '' "s/<FEATURE-NAME>/$SLUG/g" "$PLAN_FILE"
sed -i '' "s|<ISSUE_LINK>|$ISSUE_LINK|g" "$PLAN_FILE"

ISSUE_BODY="$ISSUE_BODY" node -e "const fs=require('fs'); const f=process.argv[1]; const body=(process.env.ISSUE_BODY||'').trimEnd(); let c=fs.readFileSync(f,'utf8'); c=c.replace('<ISSUE_BODY>', body); fs.writeFileSync(f,c);" "$PLAN_FILE"

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

if echo "$CURRENT_VALUE" | grep -Eqi '[/\\]test$'; then
    # Remove trailing /test or \test (case-insensitive), normalizing to base path
    NEW_VALUE=$(printf '%s\n' "$CURRENT_VALUE" | sed -E 's{[/\\]test$}{}I')
    echo "Switching TimeScope global storage to: $NEW_VALUE"
else
    # Add /test using a forward slash for cross-platform compatibility
    NEW_VALUE="${CURRENT_VALUE%/}/test"
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
echo "✓ Plan file created"
echo ""
echo "Next steps:"
echo "1. Fill out Summary and User-Facing Behavior"
echo "2. Let the agent generate the Implementation Plan"
