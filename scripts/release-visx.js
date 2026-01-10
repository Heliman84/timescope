#!/usr/bin/env node

const https = require('https')
const { execSync } = require('child_process')
const readline = require('readline')
const fs = require('fs')

function getRepoInfo() {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const repoUrl = pkg.repository && pkg.repository.url
  if (!repoUrl) return null
  const m = repoUrl.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/)
  if (!m) return null
  return { owner: m[1], repo: m[2] }
}

function prompt(question, defaultValue) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(`${question}${defaultValue ? ` (${defaultValue})` : ''}: `, answer => {
      rl.close()
      resolve(answer || defaultValue)
    })
  })
}

function run(cmd) {
  return execSync(cmd, { stdio: 'pipe' }).toString().trim()
}

async function main() {
  // ensure git is clean and branch is pushed
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

  let branch = ''
  try { branch = run('git rev-parse --abbrev-ref HEAD') } catch(e) {}

  try {
    // check that branch has an upstream
    run(`git rev-parse --verify origin/${branch}`)
    // check for unpushed commits (local ahead) or missing remote commits (local behind)
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

  const repo = getRepoInfo()
  if (!repo) {
    console.error('Unable to determine repository owner/repo from package.json. Aborting.')
    process.exit(1)
  }

  const bump = await prompt('Release type — choose one: major, minor, patch', 'patch')
  if (!['major','minor','patch'].includes(bump)) {
    console.error('Invalid bump type. Must be one of: major, minor, patch')
    process.exit(1)
  }
  const inputBranch = await prompt('Branch to release from', branch || '')

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (!token) {
    console.error('\nA GitHub token is required to trigger the workflow.');
    console.error('Set the environment variable GITHUB_TOKEN (or GH_TOKEN) and try again.');
    console.error("Example (mac/linux): export GITHUB_TOKEN=xxxx\nExample (windows pwsh): $env:GITHUB_TOKEN='xxxx'")
    process.exit(1)
  }

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

  const req = https.request(options, res => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log(`Workflow dispatched for branch '${inputBranch}' with bump '${bump}'.`)
      console.log('Check Actions in GitHub to follow progress.')
      process.exit(0)
    } else {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        console.error('Failed to dispatch workflow', res.statusCode, data)
        process.exit(1)
      })
    }
  })

  req.on('error', err => { console.error('Request error', err); process.exit(1) })
  req.write(body)
  req.end()
}

main()
