# Changelog

One line per merged PR, added at PR time under **Unreleased**. At release, entries move under the new version heading and become the GitHub Release notes.


## Unreleased

- Claude-driven development process: three chat-driven workflow skills (feature / install / release), CLAUDE.md, PR CI, isolated F5 test storage; retired the legacy script-based workflow
- Playwright UI test suite for the dashboard webview (`npm run test:ui`): renders the real dashboard against fixture data, covering charts, filters, session table, and the edit-modal round-trip
- `npm run seed-testdata`: generate fresh multi-week F5 test data into the isolated test-workspace storage


## v0.2.0 — 2026-02-25

- Recover orphaned sessions when VS Code closes while a job is running (#9, #23)
- Dashboard: job editing and highlighting from the stacked bar chart
- Fixed lost ability to add new jobs (#27, #28)


## v0.1.0

- Initial release: start/pause/resume/stop session tracking from the status bar, jobs, summary dashboard (pie, stacked bars, session table), global + workspace JSONL storage
