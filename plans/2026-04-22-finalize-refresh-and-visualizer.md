# Finalize Refresh And Visualizer

## Goal
Finish the refreshed benchmark sweep, clean up any transient failed runs, finalize the judge-first visualizer defaults, and leave the repo in a commit-ready state with incremental commits.

## TODO
- [x] Audit the refreshed 2026-04-21 v2 runs for incomplete judge coverage or transient collect failures.
- [x] Rerun recoverable parse-error questions and restore all nine refreshed v2 aggregates to full 83-run coverage.
- [x] Decide whether to keep or further retry the remaining provider-side parse failures in `gptoss-open`, `nemotron-db`, and `nemotron-open`.
- [x] Tighten the visualizer recent-runs generator so bundled data favors complete canonical v2 runs instead of smoke or partial runs.
- [x] Regenerate visualizer bundled data and verify the app build against the completed refreshed suite.
- [ ] Commit the finalization work in separate logical commits with Daniel-style messages.

## Progress Notes
- [2026-04-22 00:10] Created the plan after confirming the background lanes finished and the refreshed 2026-04-21 v2 suite exists for all nine model/mode/tool-set combinations, but several runs still have transient "Assistant produced no final text" collect errors and the visualizer bundle still needs curation.
- [2026-04-22 00:38] Audited every refreshed v2 aggregate and grouped the bad runs by execution. The failures were all parse-level collect issues rather than judge crashes, with the biggest clusters in `gptoss-open` and `nemotron-open`.
- [2026-04-22 01:09] Reran the parse-error subsets, restored both open-book aggregates back to 83 recorded runs, and cleared the recoverable Mercury and GPT OSS DB failures. A smaller set of provider-side parse failures still reproduces for `gptoss-open`, `nemotron-db`, and especially `nemotron-open`.
- [2026-04-22 01:12] Tightened `tools/benchmark-visualizer/scripts/generate-recent-runs.mjs` so the bundled site prefers complete benchmark suites based on the dataset question count, then regenerated the question bank and recent-runs bundle. The bundled visualizer snapshot now points at the nine refreshed 2026-04-21 v2 suites instead of smoke or partial runs.
- [2026-04-22 01:13] Re-verified `cd tools/benchmark-visualizer && npm run build`. The build passes, with the existing large-bundle warning unchanged.
- [2026-04-22 01:18] Chose to keep the remaining parse failures as recorded run errors rather than loop forever on the same provider behavior. After targeted reruns, the residual failures are now stable and isolated to 4 questions in `gptoss-open`, 2 in `nemotron-db`, and 13 in `nemotron-open`.

## Final notes and learnings
- Pending final commit pass.
