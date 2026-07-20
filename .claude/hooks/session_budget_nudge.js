#!/usr/bin/env node
// Stop hook — nudges toward bounded sessions.
//
// The wave-3 retro showed the dominant cost/quality problem was session length: satellites ran
// ~125 turns / ~19h with no compaction, context pinned near 200K, and response quality collapsed
// (avg output 2,045 → 290 tokens as context saturated). Hooks can't read context size, so we use
// turn count as the available proxy and emit an escalating, non-blocking reminder to checkpoint
// to the dev-log and continue in a fresh session (the spine's "disposable-but-durable" rule,
// applied to satellites). Never blocks; fail-open.

const fs = require("fs");
const os = require("os");
const path = require("path");

const FIRST_AT = 40;   // give short tasks room before the first nudge
const INTERVAL = 30;   // then remind every 30 turns

function read_stdin() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

function main() {
  let input = {};
  try { input = JSON.parse(read_stdin() || "{}"); } catch { return; }

  const sid = input.session_id;
  if (!sid) return;

  const counter = path.join(os.tmpdir(), `ts-turns-${String(sid).replace(/[^\w.-]/g, "_")}.json`);
  let count = 0;
  try { count = JSON.parse(fs.readFileSync(counter, "utf8")).count || 0; } catch {}
  count += 1;
  try { fs.writeFileSync(counter, JSON.stringify({ count })); } catch {}

  // Only speak at the thresholds, not every turn.
  if (count < FIRST_AT || (count - FIRST_AT) % INTERVAL !== 0) return;

  const urgency =
    count >= 100 ? "URGENT" : count >= 70 ? "You should wrap this session soon" : "Heads-up";
  const context =
    `Session length check (${urgency}) — this session has run ~${count} turns. Long sessions ` +
    "in wave 3 saturated context (~200K) and visibly collapsed response quality. If a coherent " +
    "unit of work is done, **checkpoint state to the dev-log and continue in a fresh session** " +
    "rather than accumulating context (bounded-session rule — delegate skill). If you're mid-slice, " +
    "finish the slice, then checkpoint.";

  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: context } }),
  );
}

try { main(); } catch { /* fail-open */ }
