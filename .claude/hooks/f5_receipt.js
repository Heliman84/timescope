#!/usr/bin/env node
// F5 staging receipt writer — the final, mandatory step of staging the F5 environment.
//
// The verifier (or orchestrator) stages the fixtures for whichever workspace the feature is
// tested in, then runs this to stamp .claude/.f5-ready.json for the current commit. The Stop
// hook (f5_staging_gate.js) refuses any F5 handoff without a fresh receipt, so this is not
// optional paperwork — it is the gate key. Running it is an attestation that you actually
// staged and eyeballed the environment.
//
// Usage:
//   node .claude/hooks/f5_receipt.js --workspace test-workspace-multi --steps "populate shared-global, open repoA+repoB windows"
//
// --workspace  the fixture workspace F5 will open (test-workspace | -empty | -multi | -legacy)
// --steps      one line describing what was staged / what the tester should do

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function git(cmd) {
  try {
    return execSync("git " + cmd, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : "";
}

function main() {
  const workspace = arg("--workspace");
  const steps = arg("--steps");
  if (!workspace) {
    process.stderr.write(
      'f5_receipt: --workspace is required (e.g. --workspace test-workspace-multi --steps "...")\n',
    );
    process.exit(1);
  }

  const repo_root = git("rev-parse --show-toplevel") || process.cwd();
  const receipt = {
    head: git("rev-parse HEAD"),
    branch: git("rev-parse --abbrev-ref HEAD"),
    workspace,
    steps,
    staged_at: new Date().toISOString(),
  };

  const dir = path.join(repo_root, ".claude");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".f5-ready.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );

  process.stdout.write(
    `F5 staging receipt written for ${receipt.branch} @ ${String(receipt.head).slice(0, 8)} (workspace: ${workspace}).\n`,
  );
}

main();
