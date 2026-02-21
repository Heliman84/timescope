#!/usr/bin/env pwsh
# release_start.ps1 - PowerShell port of release_start.sh

# Ensure we are on develop
$currentBranch = git rev-parse --abbrev-ref HEAD
if ($currentBranch -ne "develop") {
    Write-Host "FAIL: release:start must be run from the develop branch"
    Write-Host "Current branch: $currentBranch"
    exit 1
}

# Run release checks
npm run check:release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ([char]0x2713 + " Release checks passed")

# Open PR creation page for develop -> main
$repoUrl = (git config --get remote.origin.url) -replace '\.git$', ''
$url = "$repoUrl/compare/main...develop?expand=1"

Start-Process $url

Write-Host ""
Write-Host ([char]0x2713 + " Opening release PR creation page")
Write-Host "Review the diff carefully, then submit the PR."

###############################################
# Remove /test from TimeScope global storage dir
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
    $baseValue = $currentValue -replace '[/\\]test$', ''

    Write-Host ""
    Write-Host "Current TimeScope global storage directory:"
    Write-Host "  $currentValue"
    Write-Host ""
    $answer = Read-Host "Switch back to non-test directory? (y/n)"

    if ($answer -eq "y") {
        $escapedValue = $baseValue -replace '\\', '\\'
        $settingsContent = $settingsContent -replace '"timescope\.global_storage_dir"\s*:\s*"[^"]*"', """timescope.global_storage_dir"": ""$escapedValue"""
        Set-Content $settingsPath $settingsContent -NoNewline
        Write-Host ([char]0x2713 + " Switched to: $baseValue")
    }
    else {
        Write-Host "Skipped switching global storage directory."
    }
}
else {
    Write-Host "Global storage directory is already non-test."
}

Write-Host ""
