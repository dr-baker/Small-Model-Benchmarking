# Root Layout Follow-up

## Goal
Finish the repo cleanup by removing unnecessary build output from the worktree, moving benchmark-definition assets under a single `benchmark/` area, and tightening the repo layout without adding a vague catch-all assets directory.

## TODO
- [x] Audit remaining root-level files plus current `dist/` output shape to decide what should move.
- [x] Remove unnecessary build output from the repo workflow so the worktree stays source-first.
- [ ] Move benchmark-definition assets under `benchmark/` and update code/docs references.
- [ ] Verify the repo layout and commands after the changes.

## Progress Notes
- 2026-04-20 00:00 Started follow-up after root cleanup to reduce remaining top-level clutter and flatten build output.
- 2026-04-20 00:09 Audited the remaining root files and confirmed the top-level layout is already down to conventional entry files (`README`, `package.json`, `tsconfig.json`, `benchmark.yaml`, env files, `AGENTS.md`). No additional source assets needed to move; the real remaining problem was the `dist/src/` build shape.
- 2026-04-20 00:13 Changed TypeScript `rootDir` from `.` to `src`, added a clean step to the build script so stale `dist/src/` output cannot linger, and rebuilt to confirm the output now lands directly under `dist/{aggregate,collect,grade,judge,shared}`.
- 2026-04-20 00:24 Re-audited after the follow-up request. Decided against a big `assets/` consolidation because `dataset/`, `prompts/`, `tool-sets/`, `rubric/`, and `corpus/` are semantically different benchmark contracts. The worthwhile cleanup is to remove in-repo `dist/` output and move `gold-evidence.v1.json` out of `rubric/` into the dataset area where it belongs.
- 2026-04-20 00:31 Removed `dist/` from the workflow by making `npm run build` a no-emit TypeScript compile check, deleted the generated `dist/` tree, moved `gold-evidence.v1.json` into the dataset area, and updated the repo docs plus dataset build script to reflect the new location.
- 2026-04-20 00:39 Confirmed `benchmark/dataset/source/final-qa-bank.md` is still the live source bank used by `scripts/build-dataset.mjs`. Decided to group benchmark-definition assets under `benchmark/`, while keeping `benchmark.yaml` at the root and keeping gold evidence with the dataset rather than the rubric.

## Final notes and learnings
- Pending final benchmark/ reorg verification.
