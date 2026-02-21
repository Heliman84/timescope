#!/usr/bin/env pwsh
# check_release_ready.ps1 - PowerShell port of check_release_ready.sh
# develop -> main release readiness check

# ============================================================
# 1. Ensure working tree is clean
# ============================================================
$status = git status --porcelain
if ($status) {
    Write-Host "FAIL: Working tree is not clean"
    exit 1
}
Write-Host ([char]0x2713 + " Working tree is clean")

$confirm = Read-Host "Did you save all files before running this script? [y/n]"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Host "Exiting so you can save your files."
    exit 1
}

# ============================================================
# 2. Ensure develop is up to date with main
# ============================================================
git fetch origin main 2>$null | Out-Null

git merge-base --is-ancestor origin/main HEAD 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL: develop is not up to date with origin/main"
    exit 1
}
Write-Host ([char]0x2713 + " develop is up to date with main")

# ============================================================
# 3.0 Version bump check
# ============================================================
$devVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
$mainPackageJson = git show origin/main:package.json 2>$null
$mainVersion = ($mainPackageJson | ConvertFrom-Json).version

if ($devVersion -eq $mainVersion) {
    Write-Host "FAIL: Version number has not been bumped (still $devVersion)"
    exit 1
}

# Semver comparison
$devParts = $devVersion.Split('.') | ForEach-Object { [int]$_ }
$mainParts = $mainVersion.Split('.') | ForEach-Object { [int]$_ }
$isGreater = $false
for ($i = 0; $i -lt [Math]::Min($devParts.Count, $mainParts.Count); $i++) {
    if ($devParts[$i] -gt $mainParts[$i]) { $isGreater = $true; break }
    if ($devParts[$i] -lt $mainParts[$i]) { break }
}
if (-not $isGreater) {
    Write-Host "FAIL: Version $devVersion is not greater than $mainVersion"
    exit 1
}
Write-Host ([char]0x2713 + " Version bumped: $mainVersion -> $devVersion")

# ============================================================
# 3.1 Ensure no existing tag already uses this version
# ============================================================
git rev-parse "v$devVersion" 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "FAIL: Tag v$devVersion already exists"
    Write-Host "Choose a new version number before releasing."
    exit 1
}
Write-Host ([char]0x2713 + " No existing tag for v$devVersion")

# ============================================================
# 4. Lint, tests, compile (quiet mode)
# ============================================================

# Lint
$null = & npm run lint --silent 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL: Lint failed"
    exit 1
}
Write-Host ([char]0x2713 + " Lint succeeded")

# Tests
$null = & npm test --silent 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL: Tests failed"
    exit 1
}
Write-Host ([char]0x2713 + " Tests succeeded")

# Compile
$null = & npm run compile --silent 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL: TypeScript compile failed"
    exit 1
}
Write-Host ([char]0x2713 + " TypeScript compile succeeded")

# ============================================================
# 5. Prepublish build
# ============================================================
$null = & npm run "vscode:prepublish" --silent 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL: vscode:prepublish failed"
    exit 1
}
Write-Host ([char]0x2713 + " Prepublish build succeeded")

# ============================================================
# 6. Clean old artifacts and run vsce package
# ============================================================
Remove-Item -Path *.vsix -Force -ErrorAction SilentlyContinue
Write-Host ([char]0x2713 + " Removed old .vsix files")

$null = & npx vsce package --no-dependencies --silent 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL: vsce package failed"
    exit 1
}
Write-Host ([char]0x2713 + " vsce package succeeded")

# ============================================================
# 7. Verify .vsix artifact exists for the correct version
# ============================================================
$expectedVsix = "timescope-$devVersion.vsix"
if (-not (Test-Path $expectedVsix)) {
    Write-Host "FAIL: Expected .vsix file not found: $expectedVsix"
    Write-Host "Make sure vsce packaged the extension with the correct version."
    exit 1
}
Write-Host ([char]0x2713 + " .vsix artifact found: $expectedVsix")

# ============================================================
# 8. Ensure no dependency changes
# ============================================================
$depDiff = git diff origin/main package.json
if ($depDiff -match '"dependencies"') {
    Write-Host "FAIL: dependencies changed relative to main"
    exit 1
}
if ($depDiff -match '"devDependencies"') {
    Write-Host "FAIL: devDependencies changed relative to main"
    exit 1
}
Write-Host ([char]0x2713 + " No dependency changes")

# ============================================================
# Final success banner
# ============================================================
Write-Host "----------------------------------------"
Write-Host ([char]0x2713 + " develop is ready to merge into main")
Write-Host "----------------------------------------"
