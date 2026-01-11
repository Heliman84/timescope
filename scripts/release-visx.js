#!/usr/bin/env node

const https = require('https')
const { execSync } = require('child_process')
const readline = require('readline')
const fs = require('fs')

/**
 * Extracts GitHub owner and repo name from package.json repository.url
 * Returns { owner, repo } or null if not found or invalid format.
 */
function getRepoInfo() {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const repoUrl = pkg.repository && pkg.repository.url
  if (!repoUrl) return null
  const m = repoUrl.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/)
  if (!m) return null
  return { owner: m[1], repo: m[2] }
}

/**
 * Prompts user for input with optional default value.
 * Returns a Promise that resolves to the user's answer or the default.
 */
function prompt(question, defaultValue) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(`${question}${defaultValue ? ` (${defaultValue})` : ''}: `, answer => {
      rl.close()
      resolve(answer || defaultValue)
    })
  })
}

/**
 * Executes a shell command synchronously and returns trimmed output.
 */
function run(cmd) {
  return execSync(cmd, { stdio: 'pipe' }).toString().trim()
}

/**
 * Main entry point: validates git state, prompts for inputs, and dispatches the workflow.
 */
async function main() {
  // --- Step 1: Check for uncommitted changes ---
  try {
    const status = run('git status --porcelain')
    if (status) {
      console.error('Uncommitted changes detected. Please commit or stash them before releasing.')
      console.error(status)
      process.exit(1)
    }
  } catch (e) {
    console.error('Failed to run git status - are you in a git repo?')
    process.exit(1)
  }

  // --- Step 2: Get current branch name ---
  let branch = ''
  try { branch = run('git rev-parse --abbrev-ref HEAD') } catch(e) {}

  // --- Step 3: Verify branch is pushed and up-to-date with origin ---
  try {
    // Check that the branch exists on origin
    run(`git rev-parse --verify origin/${branch}`)
    // Compare local vs remote commit counts (left = remote, right = local)
    const counts = run(`git rev-list --left-right --count origin/${branch}...${branch}`)
    const parts = counts.split('\t')
    const behind = parseInt(parts[0] || '0', 10)
    const ahead = parseInt(parts[1] || '0', 10)
    if (behind > 0) {
      console.error(`Your branch is behind origin/${branch} by ${behind} commit(s). Please pull/merge and ensure the branch is up-to-date before releasing.`)
      process.exit(1)
    }
    if (ahead > 0) {
      console.error(`Your branch has ${ahead} unpushed commit(s). Please push them before releasing.`)
      process.exit(1)
    }
  } catch (e) {
    console.error(`Branch '${branch}' does not appear to exist on origin. Please push it: git push -u origin ${branch}`)
    process.exit(1)
  }

  // --- Step 4: Extract repo owner/repo from package.json ---
  const repo = getRepoInfo()
  if (!repo) {
    console.error('Unable to determine repository owner/repo from package.json. Aborting.')
    process.exit(1)
  }

  // --- Step 5: Prompt user for release type (major/minor/patch) ---
  const bump = await prompt('Release type — choose one: major, minor, patch', 'patch')
  if (!['major','minor','patch'].includes(bump)) {
    console.error('Invalid bump type. Must be one of: major, minor, patch')
    process.exit(1)
  }

  // --- Step 6: Prompt user for branch name (default: current branch) ---
  const inputBranch = await prompt('Branch to release from', branch || '')

  // --- Step 7: Check for GitHub token (GITHUB_TOKEN or GH_TOKEN env var) ---
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (!token) {
    console.error('\nA GitHub token is required to trigger the workflow.');
    console.error('Set the environment variable GITHUB_TOKEN (or GH_TOKEN) and try again.');
    console.error("Example (mac/linux): export GITHUB_TOKEN=xxxx\nExample (windows pwsh): $env:GITHUB_TOKEN='xxxx'")
    process.exit(1)
  }

  // --- Step 8: Build and send API request to dispatch the workflow ---
  const body = JSON.stringify({ ref: inputBranch, inputs: { branch: inputBranch, bump } })
  const options = {
    method: 'POST',
    hostname: 'api.github.com',
    path: `/repos/${repo.owner}/${repo.repo}/actions/workflows/release-visx.yml/dispatches`,
    headers: {
      'User-Agent': 'release-visx-script',
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }

  // --- Step 9: Handle response ---
  const req = https.request(options, res => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      // Success: workflow dispatch accepted
      console.log(`Workflow dispatched for branch '${inputBranch}' with bump '${bump}'.`)
      console.log('Check Actions in GitHub to follow progress.')
      process.exit(0)
    } else {
      // Error: log response details
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        console.error('Failed to dispatch workflow', res.statusCode, data)
        process.exit(1)
      })
    }
  })

  // Handle network errors
  req.on('error', err => { console.error('Request error', err); process.exit(1) })
  req.write(body)
  req.end()
}

main()
