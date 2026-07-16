---
name: release
description: TimeScope release loop — use when the user asks to do a release, merge develop into main, bump the version, tag, or publish a GitHub release with the vsix.
---

# Release Loop (develop → main → GitHub Release)

Fully chat-driven. The user's only manual step is reviewing/merging the release PR.

## 1. Preflight (on develop)

- Working tree clean, `git pull` — up to date with origin/develop
- `npm test` green
- `npm run package` succeeds (proves the vsix builds)

## 2. Bump

- Ask the user: major / minor / patch → edit `version` in `package.json`
- In `CHANGELOG.md`: move the **Unreleased** entries under a new `## vX.Y.Z — <date>` heading
- Offer to update the README roadmap if features shipped from it
- Commit (`chore(release): vX.Y.Z`) and push to develop

## 3. Release PR

```
gh pr create --base main --head develop --title "Release vX.Y.Z" --body "<changelog entries>"
```

Body = the changelog entries for this version (fallback: summarize `git log main..develop`).

## 4. User gate

Offer to install the release-candidate vsix locally first (install skill) so the user can smoke-test. Then the user reviews and merges the PR. Wait — do not merge it yourself.

## 5. Publish (after merge, on request)

Before tagging, verify version/tag consistency (the old CI did this atomically; now it's on you):

- `node -p "require('./package.json').version"` on main MUST equal the X.Y.Z you are about to tag
- `git tag -l vX.Y.Z` MUST be empty (no duplicate tag)
- If either check fails, STOP and fix the version on develop via a new release PR — never tag a mismatched version

```
git checkout main && git pull
git tag vX.Y.Z && git push origin vX.Y.Z
npm run package
gh release create vX.Y.Z timescope-X.Y.Z.vsix --title "vX.Y.Z" --notes "<changelog entries>"
```

The packaged filename comes from package.json's version — if it doesn't match the tag, the consistency check above was skipped.

The `.vsix` attached to the GitHub Release is the official distribution artifact — it is never committed.

## 6. Close out

`git checkout develop && git pull`; if main gained a merge commit develop doesn't have, merge main back into develop and push. Report the release URL.
