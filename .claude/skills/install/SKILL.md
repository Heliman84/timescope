---
name: install
description: TimeScope install loop — use when the user asks to recompile, package, or install the latest develop build of the extension into their main VS Code ("install the latest build", "update my extension").
---

# Install Loop (develop → local VS Code)

1. `git checkout develop && git pull`
2. If `package-lock.json` changed since last install: `npm install`
3. `npm run package` — runs prepublish (compile + copy dashboard assets + writes `out/buildinfo.json`), then `vsce package`, producing `timescope-<version>.vsix` (version from `package.json`)
4. `code --install-extension timescope-<version>.vsix`
5. Read `out/buildinfo.json` and tell the user: installed version X.Y.Z from commit `<short-sha>` — reload the VS Code window (`Developer: Reload Window`) to activate it. Compare `commit` against `git rev-parse HEAD` on `develop`; if they differ, flag it (the packaged commit is stale relative to current develop).

Notes:

- `.vsix` files are gitignored — never commit them.
- If the user was on a feature branch, return them to it afterwards.
