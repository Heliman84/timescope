# US-12 — Opt in to tracking a folder

**As** the user, **I need** to explicitly opt in to using TimeScope in a folder/repo, **so that**
TimeScope never touches a project I haven't chosen to track.

## Context

I've installed TimeScope. Its global tracking is always there in the status bar. I open a folder or
repo in VS Code. I have **not** decided whether I want this project's time committed into the project
itself. Nothing about this folder is special to TimeScope yet.

## Trigger

Opting in is only ever offered in response to **me pressing Start** for the first time in a folder
that isn't already tracked. Opening the folder, activating the extension, or browsing files is *not*
a trigger — I initiate it.

## Expected experience

Before I press Start, TimeScope does nothing to my folder: no `.timescope/` directory, no files
written into the repo, no prompt about local tracking. It stays out of the way.

The first time I press Start in an untracked folder, TimeScope asks me **once**: do I want this
workspace's time committed into a `.timescope/` folder in the repo, in addition to global tracking?
I get three clear choices:

- **Track here** — TimeScope creates `.timescope/` with a small committed `config.json` (a stable
  repo id). From now on this repo owns its own sessions locally. The session I just started keeps
  running; nothing is lost. I get a brief confirmation.
- **Not now** — nothing is created in the repo; my session still tracks (globally). TimeScope may ask
  again in a future session, but it won't nag me again *this* session.
- **Never for this folder** — nothing is created, and I'm never asked again (on this machine) for
  this folder.

If I clone/open a repo that **already** has a committed `.timescope/` folder, it's treated as already
opted in — I get no prompt, and tracking is local from the first Start.

## Must NOT happen

- No `.timescope/` folder — or any write into the repo — before I opt in.
- No opt-in prompt on folder-open or extension activation. Only on the Start I initiate.
- No repeated prompting within a session; and no prompting again **on this machine** after "Never for this folder."
- Opting in must not drop or restart the session I just began.
- A stray *file* named `.timescope` must never be mistaken for opt-in, and must never crash the
  first write.

## Edge cases

- **No workspace open (loose files):** global tracking only; opt-in isn't offered.
- **`.timescope` exists as a directory:** already opted in → no prompt.
- **`.timescope` exists as a plain file:** not opt-in; don't crash — treat as un-opted-in.
- **Same folder on another machine:** opt-*in* travels (it's the committed `.timescope/` folder, so a
  clone is opted in everywhere). A **decline is deliberately machine-local** — it writes nothing into
  the repo, because committing it would force your personal "don't track" choice on everyone who
  clones — so a different machine has no record of it and can prompt again there. That's by design, and
  reversible from the #6 Settings tab.
- **Where decisions live (adopted model):** *travels → repo; machine-local → registry.* The portable
  opt-in fact is the committed `.timescope/`. Everything machine-local lives in one inspectable store,
  `registry.json` (known repos **and** declined folders) — the decline moves off VS Code's opaque
  `workspaceState`. The #6 Settings tab reads/writes the registry to show and reverse declines.
- **Declined "Never" previously, then I change my mind:** the way back in lives in the **Settings tab
  of the Summary view** (built in [#6](https://github.com/Heliman84/timescope/issues/6)) — I can
  reverse a folder's opt-in/opt-out there, or stop tracking a folder that was opted in.

## Traceability

- **Delivered by:** [#2](https://github.com/Heliman84/timescope/issues/2), built in #48 phase 48a.
- **Status:** done — first-Start prompt, three choices, and existing-folder-implies-opted-in all
  implemented; "Never" persists per folder.
- **Related:** [[US-05]] (time committed with the repo), [[US-06]] (opening an existing repo),
  [[US-10]] (the Settings-tab management UI where opt-in/opt-out is reversed).
- **Open questions:** none blocking. *Resolved:* re-opt-in lives in the #6 Settings tab; a decline is
  machine-local **by design** (committing it would force it on everyone who clones). Storage model —
  **done:** declines now persist in `registry.json` (not VS Code `workspaceState`); only the reversal
  *UI* remains for #6.
