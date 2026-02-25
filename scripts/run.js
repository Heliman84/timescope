#!/usr/bin/env node
// Cross-platform script runner
// Usage: node scripts/run.js <script-name>
// Runs scripts/<script-name>.ps1 on Windows, scripts/<script-name>.sh elsewhere

const { execFileSync } = require('child_process');
const path = require('path');

const name = process.argv[2];
if (!name) {
  console.error('Usage: node scripts/run.js <script-name>');
  process.exit(1);
}

const scriptDir = __dirname;
const isWindows = process.platform === 'win32';

try {
  if (isWindows) {
    const script = path.join(scriptDir, name + '.ps1');
    execFileSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', script], {
      stdio: 'inherit',
      cwd: path.join(scriptDir, '..'),
    });
  } else {
    const script = path.join(scriptDir, name + '.sh');
    execFileSync('bash', [script], {
      stdio: 'inherit',
      cwd: path.join(scriptDir, '..'),
    });
  }
} catch (e) {
  process.exit(e.status || 1);
}
