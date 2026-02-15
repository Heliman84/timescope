#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const isWindows = process.platform === 'win32';
const scriptPath = path.join(__dirname, isWindows ? 'feature_start_gh.ps1' : 'feature_start_gh.sh');
const command = isWindows ? 'pwsh' : 'bash';
const args = isWindows ? ['-File', scriptPath] : [scriptPath];

const child = spawn(command, args, {
    stdio: 'inherit',
    shell: false
});

child.on('exit', (code) => {
    process.exit(code || 0);
});

child.on('error', (err) => {
    console.error('Failed to start script:', err);
    process.exit(1);
});
