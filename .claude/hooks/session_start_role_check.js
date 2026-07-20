#!/usr/bin/env node
// SessionStart hook — casts the window's role and checks the model tier.
//
// Why this exists: the arc/agent process (docs/agent-process.md) assumes a cold chat
// will voluntarily (a) run orchestration/coordination on opus, not the top-tier Fable,
// and (b) delegate bulk work to the model-pinned project agents. Nothing enforced that,
// so a satellite once ran its whole feature loop inline on Fable at high effort. This
// hook makes the expectation loud at every session start. It never blocks (SessionStart
// can't); it injects a system reminder the model reads before the first turn.
//
// Fail-open by design: any error just emits no context rather than disrupting the session.

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

function main() {
  let input = {};
  try {
    input = JSON.parse(read_stdin() || "{}");
  } catch {
    input = {};
  }

  const cwd = input.cwd || process.cwd();
  const model = String(input.model || "").toLowerCase();
  const branch = current_branch(cwd);
  const on_protected = branch === "develop" || branch === "main";
  const on_fable = model.includes("fable");
  const on_opus = model.includes("opus");

  const lines = [];

  // Model tier — the expensive mistake this whole hook exists to catch.
  if (on_fable) {
    lines.push(
      "MODEL CHECK — this window is on **Fable**, our top tier. Orchestration and " +
        "coordination should run on **opus** (Fable doing bulk/inline work is what blew a " +
        "whole session budget). Switch now with `/model opus` unless you deliberately need " +
        "Fable for this turn. Bulk implementation belongs in project agents, which self-" +
        "select their own model — never inline in this window.",
    );
  } else if (!on_opus && model) {
    lines.push(
      `MODEL CHECK — this window is on \`${model}\`. Main coordination/orchestration windows ` +
        "should be on **opus**; delegate implementation to the project agents.",
    );
  }

  // Role — who is this window in the arc/agent process?
  if (on_protected) {
    lines.push(
      `ROLE — branch \`${branch}\`. This is the **arc spine / main coordination window**: ` +
        "coordinate and decide only. Do **not** edit source here (a PreToolUse hook enforces " +
        "this — only `docs/` and `.claude/` are writable on develop/main). Your durable state " +
        "is the arc log; delegate all implementation to satellites/agents.",
    );
  } else if (branch) {
    lines.push(
      `ROLE — branch \`${branch}\`. You are the **orchestrator** for this issue, not a coder. ` +
        "Before creating branches, spawning a builder, or editing source: **agree scope with " +
        "the user in their own words** (feature loop §1 — a hard gate, do not skip it). Delegate " +
        "verbose/mechanical work to the project agents (`.claude/agents/`); they self-select " +
        "sonnet/opus. Run the **verifier** and stage the F5 environment before any F5 handoff " +
        "(a Stop hook enforces this).",
    );
  }

  if (lines.length === 0) return;

  const context =
    "TimeScope process guardrails (auto-injected at session start):\n\n- " +
    lines.join("\n\n- ");

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: context,
      },
    }),
  );
}

try {
  main();
} catch {
  // Fail-open: never let a guardrail bug disrupt a session.
}
