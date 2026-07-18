# Arc: <title>

> **Arc log**, not a spec. The *spine* above the per-issue [dev-logs](../dev-log/) — it holds
> the decisions and structure that span multiple issues. Each issue keeps its own dev-log for
> its own *why*; this file is the shared north star and the live map of the effort.
> *(An "arc" both spans multiple issues and is short for architecture — which is what these
> efforts usually are.)* Keep it short and diagram-first. Skip any section that doesn't apply.

**Milestone:** <link>  ·  **Epic/architecture issue:** <link>  ·  **Started:** <YYYY-MM-DD>

## Why this arc exists

The root problem or opportunity that no single issue owns — the reason these issues are one
effort rather than a list. Name the user-critical outcomes that drive the sequence.

## Target architecture

A mermaid diagram of the end state (`flowchart` / state / sequence — whatever fits). This is
the north star every issue in the arc aims at.

## Load-bearing decisions

The choices that shape the whole arc and constrain every issue under it — the reasoning that
must not get re-litigated per issue. (Per-issue trade-offs stay in that issue's dev-log.)

## Build order & status

The sequence and any parallelism (waves/tracks), plus a live table linking each issue to its
work. Update the Status column as the arc progresses.

| Wave | Issue | Track | Dev-log | Status |
| :--- | :--- | :--- | :--- | :--- |
| 1 | [#N](issue-link) <title> | <track> | [issue-N-slug](../dev-log/issue-N-slug.md) | not started |

## Future capabilities — designed-for, not-in-scope

Things the architecture must not block but this arc won't build. Note the schema/interface
seams that keep them cheap later. (Delete if none.)

## Related documents

- Epic/architecture discussion: <issue link>
- Data formats / process diagrams touched by the arc: <links>
