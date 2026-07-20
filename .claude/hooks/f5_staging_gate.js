#!/usr/bin/env node
// Stop hook — refuses an F5 handoff unless the test environment was actually staged.
//
// Why a receipt, not a filesystem guess: TimeScope has several F5 fixture workspaces
// (test-workspace, -empty, -multi, -legacy) and their global-storage/ contents are
// gitignored, so a fresh worktree starts with an EMPTY test environment. "Correct staging"
// is feature-specific (one fixture wants data, the opt-in fixture wants NO .timescope), so
// no single filesystem check is right. Instead the staging step must stamp a receipt
// (.claude/.f5-ready.json) for the current commit via f5_receipt.js. This hook enforces that
// a fresh receipt exists before any F5 handoff reaches the user — the omission that has
// repeatedly shipped broken test environments.
//
// Fires only on turns whose final message looks like an F5 handoff; fail-open on error.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function read_stdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function looks_like_f5_handoff(message) {
  const m = String(message || "").toLowerCase();
  if (!/\bf5\b/.test(m)) return false;
  return (
    /(press|hit|run|when you|then)\s+\S{0,8}f5/.test(m) ||
    /extension development host/.test(m) ||
    /how to test/.test(m) ||
    /test steps/.test(m) ||
    /ready (to|for) (test|f5|you)/.test(m) ||
    /^\s*step\s+\d+\s*\/\s*\d+/m.test(m) ||
    /branch is ready/.test(m)
  );
}

function git(cmd, cwd) {
  try {
    return execSync("git " + cmd, {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

// Returns null when a fresh receipt is present, or a reason string when it is missing/stale.
function receipt_problem(cwd) {
  // Resolve the repo root so the reader matches the writer (f5_receipt.js writes under
  // `git rev-parse --show-toplevel`); reading relative to a subdirectory cwd would miss it.
  const repo_root = git("rev-parse --show-toplevel", cwd) || cwd;
  const receipt_path = path.join(repo_root, ".claude", ".f5-ready.json");
  if (!fs.existsSync(receipt_path)) {
    return "no F5 staging receipt (.claude/.f5-ready.json) — nobody staged the test environment";
  }
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receipt_path, "utf8"));
  } catch {
    return "F5 staging receipt is unreadable — re-stage the environment";
  }
  const head = git("rev-parse HEAD", repo_root);
  const branch = git("rev-parse --abbrev-ref HEAD", repo_root);
  if (head && receipt.head && receipt.head !== head) {
    return `F5 staging receipt is stale (staged for ${String(receipt.head).slice(0, 8)}, HEAD is ${head.slice(0, 8)}) — re-stage after the latest commit`;
  }
  if (branch && receipt.branch && receipt.branch !== branch) {
    return `F5 staging receipt is for a different branch (${receipt.branch}, not ${branch})`;
  }
  return null; // fresh
}

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

function main() {
  let input = {};
  try {
    input = JSON.parse(read_stdin() || "{}");
  } catch {
    return; // allow stop
  }

  if (!looks_like_f5_handoff(input.last_assistant_message)) return; // allow stop

  const cwd = input.cwd || process.cwd();
  const problem = receipt_problem(cwd);
  if (!problem) return; // staged — allow stop

  block(
    "F5 handoff blocked — " +
      problem +
      ".\nThe verifier must actually stage the fixtures for the workspace this feature is " +
      "tested in (test-workspace / -empty / -multi / -legacy), then stamp the receipt:\n" +
      '  node .claude/hooks/f5_receipt.js --workspace <name> --steps "<one-line what to do>"\n' +
      "Only then hand off. If this turn is NOT an F5 handoff, restate it without F5 test wording.",
  );
}

try {
  main();
} catch {
  // Fail-open: never trap the model in a turn because of a guardrail bug.
}
