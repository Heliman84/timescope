#!/usr/bin/env node
// Stop hook — refuses to end a turn that announced a PR while the branch's dev-log still shows
// an unfilled PR link.
//
// This exact omission — leaving `**PR:** TBD` in the dev-log after creating the PR — has
// recurred across several PRs. The feature-loop checklist line for it was advisory and kept
// getting skipped, so it is now enforced at the moment it happens: if the turn's final message
// contains a GitHub /pull/<n> URL and the current feature branch's dev-log PR field is still a
// placeholder, block the Stop and name the file to fix.
//
// Cheap (no network) and fail-open.

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

function current_branch(cwd) {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

// A PR field is "filled" once it carries a real reference: a #<number> or a /pull/ link.
function pr_field_is_placeholder(text) {
  const m = text.match(/\*\*PR:\*\*\s*([^\n·|]*)/);
  if (!m) return false; // no PR field in this dev-log — nothing to enforce
  const value = m[1].trim();
  if (!value) return true;
  return !/#\d/.test(value) && !/\/pull\//.test(value);
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

  const message = String(input.last_assistant_message || "");
  const pr_url = message.match(/https?:\/\/github\.com\/[^\s)]+\/pull\/\d+/);
  if (!pr_url) return; // no PR announced this turn — allow stop

  const cwd = input.cwd || process.cwd();
  const branch = current_branch(cwd);
  const issue = branch.match(/issue-(\d+)/);
  if (!issue) return; // not a numbered feature branch — allow stop

  const dir = path.join(cwd, "docs", "dev-log");
  let files = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`issue-${issue[1]}-`) && f.endsWith(".md"));
  } catch {
    return; // no dev-log dir — allow stop
  }

  for (const f of files) {
    const full = path.join(dir, f);
    let text = "";
    try {
      text = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (pr_field_is_placeholder(text)) {
      block(
        `You referenced ${pr_url[0]} but docs/dev-log/${f} still has an unfilled ` +
          "`**PR:**` field. Fill it with the PR link and commit before finishing — this is " +
          "the finalize-the-dev-log step of the feature loop, now enforced.",
      );
      return;
    }
  }
}

try {
  main();
} catch {
  // Fail-open: never trap the model in a turn because of a guardrail bug.
}
