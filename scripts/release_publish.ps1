#!/usr/bin/env pwsh
# release_publish.ps1 - PowerShell port of release_publish.sh

# Ensure we are on main
$currentBranch = git rev-parse --abbrev-ref HEAD
if ($currentBranch -ne "main") {
    Write-Host "FAIL: release:publish must be run from the main branch"
    Write-Host "Current branch: $currentBranch"
    exit 1
}

# Ensure working tree is clean
$status = git status --porcelain
if ($status) {
    Write-Host "FAIL: Working tree is not clean. Commit or stash changes first."
    exit 1
}

# Extract version from package.json (no jq needed)
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$tag = "v$version"

Write-Host "Preparing to publish release: $tag"
$answer = Read-Host "Tag and push release $tag ? (y/n)"
if ($answer -ne "y") {
    Write-Host "Aborted."
    exit 0
}

Write-Host "Tagging release..."
git tag $tag

Write-Host "Pushing tag..."
git push origin $tag

Write-Host ""
Write-Host ([char]0x2713 + " Tag pushed: $tag")
Write-Host "Opening GitHub Releases page..."
Write-Host ""

# Derive repository URL from the git origin remote
$repoUrl = git config --get remote.origin.url

# Normalize common GitHub URL formats to https://github.com/owner/repo
$repoUrl = $repoUrl `
    -replace '^git@github\.com:', 'https://github.com/' `
    -replace '\.git$', '' `
    -replace '/$', ''

Start-Process "$repoUrl/releases/new?tag=$tag"

Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Upload the .vsix file as a release asset"
Write-Host "2. Publish the release"
Write-Host ""
