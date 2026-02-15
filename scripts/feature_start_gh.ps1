#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

# Require running on a feature branch (GH PR extension should have created it)
$currentBranch = git rev-parse --abbrev-ref HEAD
if ($currentBranch -notmatch "^feature/") {
    Write-Host "FAIL: feature:start-gh must be run from a feature/* branch"
    Write-Host "Current branch: $currentBranch"
    Write-Host ""
    Write-Host "Use the GitHub Pull Request extension to 'Start working on issue' first."
    exit 1
}

$issueNumber = ""
$issueTitle = ""

if ($currentBranch -match "^feature/") {
    $branchSuffix = $currentBranch -replace "^feature/", ""
    # Handle formats: 123-title, issue123-title, issue123--title, etc.
    if ($branchSuffix -match "^(?:issue)?(\d+)[-_]+([\w\-]+.*)$") {
        $issueNumber = $Matches[1]
        $issueTitle = $Matches[2]
    }
    elseif ($branchSuffix -match "^(?:issue)?(\d+)$") {
        $issueNumber = $Matches[1]
    }
}

if (-not $issueNumber) {
    $issueNumber = Read-Host "Issue number"
}

if (-not $issueTitle) {
    $issueTitle = Read-Host "Issue title"
}

# Convert to slug (lowercase, hyphens, no extra spaces)
$titleSlug = $issueTitle.ToLower() -replace "[^a-z0-9]+", "-" -replace "^-+|-+$", ""

$slug = "$issueNumber-$titleSlug"
$featureName = "Issue $issueNumber - $issueTitle"

$planFile = "pr/$slug.md"
$template = "pr/01_pr_feature_template.md"

if (Test-Path $planFile) {
    Write-Host "FAIL: plan file already exists: $planFile"
    exit 1
}

Write-Host "Creating plan file: $planFile"
Copy-Item $template $planFile

# Determine repo URL for Issue link
$remoteUrl = git config --get remote.origin.url 2>$null
if (-not $remoteUrl) {
    Write-Host "FAIL: unable to read remote.origin.url"
    exit 1
}

# Normalize to https://github.com/owner/repo format
$repoUrl = $remoteUrl `
    -replace "^git@github\.com:", "https://github.com/" `
    -replace "^ssh://git@github\.com/", "https://github.com/" `
    -replace "^https?://github\.com/", "https://github.com/" `
    -replace "\.git$", ""

$issueUrl = "$repoUrl/issues/$issueNumber"
$issueLink = "[#$issueNumber]($issueUrl)"

$issueBody = ""
$ownerRepo = $repoUrl -replace '^https://github.com/', ''
$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
    try {
        $issueBody = gh api "repos/$ownerRepo/issues/$issueNumber" --jq ".body" 2>$null
    }
    catch {
        $issueBody = ""
    }
}
$issueBody = $issueBody.TrimEnd()

# Replace placeholders in template
$content = Get-Content $planFile -Raw
$content = $content -replace "<FEATURE_NAME>", $featureName
$content = $content -replace "<FEATURE-NAME>", $slug
$content = $content -replace "<ISSUE_LINK>", $issueLink
$content = [regex]::Replace($content, "<ISSUE_BODY>", [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $issueBody })
Set-Content $planFile $content -NoNewline

Write-Host "Opening plan file..."
code $planFile

###############################################
# Toggle TimeScope global storage directory
###############################################

$settingsPath = "$env:APPDATA\Code\User\settings.json"

if (-not (Test-Path $settingsPath)) {
    Write-Host "FAIL: VS Code settings.json not found at:"
    Write-Host "  $settingsPath"
    exit 1
}

$settingsContent = Get-Content $settingsPath -Raw

if ($settingsContent -match '"timescope\.global_storage_dir"\s*:\s*"([^"]*)"') {
    $currentValue = $Matches[1]
}
else {
    Write-Host "FAIL: timescope.global_storage_dir is not set in settings.json"
    exit 1
}

if ($currentValue -match '[/\\]test$') {
    # Remove trailing /test or \test
    $newValue = $currentValue -replace '[/\\]test$', ''
    Write-Host "Switching TimeScope global storage to: $newValue"
}
else {
    # Add /test using a forward slash for cross-platform compatibility
    $newValue = "$($currentValue.TrimEnd('/'))/test"
    Write-Host "Switching TimeScope global storage to: $newValue"
}

# Escape backslashes for JSON
$escapedValue = $newValue -replace '\\', '\\'

# Update settings.json
$settingsContent = $settingsContent -replace '"timescope\.global_storage_dir"\s*:\s*"[^"]*"', """timescope.global_storage_dir"": ""$escapedValue"""
Set-Content $settingsPath $settingsContent -NoNewline

Write-Host "✓ TimeScope global storage directory setting updated"
Write-Host ""

###############################################

Write-Host ""
Write-Host "✓ Plan file created"
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Fill out Summary and User-Facing Behavior"
Write-Host "2. Let the agent generate the Implementation Plan"
