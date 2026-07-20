#!/usr/bin/env node
// PreToolUse hook (matcher: Edit|Write) — enforces "no feature work on develop/main".
//
// CLAUDE.md has always said "confirm the branch is not develop/main before the first
// edit", but it was advisory and got skipped. This makes it mechanical: a source edit on
// develop or main is denied outright. Docs and .claude/ stay writable so the arc spine can
// maintain the arc log / process files on develop, and so this very process-fix branch works.
//
// Fail-open: if we cannot determine the branch or path, allow (a guardrail bug must never
// block all edits). Source list is intentionally narrow — the real "feature work" surface.

const { execSync } = require("child_process");

function read_stdin() {
  try {
    return require("fs").readFileSync(0, "utf8");
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

function is_source_path(file_path) {
  // Normalise separators so the check works on Windows and POSIX alike.
  const p = String(file_path || "").replace(/\\/g, "/");
  if (!p) return false;
  const base = p.split("/").pop();
  // Package / build manifests: a change here is always feature/release work.
  if (["package.json", "package-lock.json"].includes(base)) return true;
  if (/^tsconfig(\.\w+)?\.json$/.test(base)) return true;
  // Compiled/source trees.
  if (/(^|\/)src\//.test(p)) return true;
  if (/(^|\/)tests?\//.test(p)) return true;
  return false;
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
}

function main() {
  let input = {};
  try {
    input = JSON.parse(read_stdin() || "{}");
  } catch {
    return; // allow
  }

  const cwd = input.cwd || process.cwd();
  const branch = current_branch(cwd);
  if (branch !== "develop" && branch !== "main") return; // allow

  const file_path = input.tool_input && input.tool_input.file_path;
  if (!is_source_path(file_path)) return; // docs/.claude/etc — allow

  deny(
    `Source edit blocked: you are on \`${branch}\`. Feature work must happen on a ` +
      "`feature/issue-<N>-<slug>` branch (feature loop §2), never on develop/main. " +
      "Create the branch first. (Only docs/ and .claude/ are writable on protected " +
      "branches — that is the spine's coordination surface.)",
  );
}

try {
  main();
} catch {
  // Fail-open: never block edits because of a guardrail bug.
}
