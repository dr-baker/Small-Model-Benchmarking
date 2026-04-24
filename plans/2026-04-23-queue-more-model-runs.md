# Queue More Model Runs

## Goal
Use the matrix runner to queue another batch of benchmark runs for four additional candidate models across every benchmark tool set, using default thinking settings and the requested provider routing where supported.

## TODO
- [x] Create a matrix config that covers all tool sets for the requested models.
- [x] Encode requested provider routing overrides for GLM and Gemma, noting any routing precision limits.
- [x] Launch the matrix runner in the background so the new runs start queueing.
- [x] Capture the launched command, matrix path, and any known caveats for follow-up reruns.

## Progress Notes
- 2026-04-23 07:xx Read the runner, tool-set catalog, and existing pilot matrix to confirm the matrix format and available tool sets.
- 2026-04-23 07:xx Decided to map tool set `none` to `closed_book` and the remaining tool sets to `open_book`, since running `open_book` with no tools would be a less meaningful duplicate of closed-book behavior.
- 2026-04-23 07:xx Left reasoning/thinking unset so the runs use the benchmark defaults, per the request for default thinking.
- 2026-04-23 07:xx Wrote `scripts/matrices/additional-models-all-toolsets.json` with 24 entries: 4 models × 6 tool sets.
- 2026-04-23 07:xx Applied requested provider pinning where the harness supports it: `deepinfra` for GLM and `google-vertex` for Gemma. The harness can pin provider names but cannot force precision labels like `deepinfra/bf16`, so the GLM runs are pinned to `deepinfra` only.
- 2026-04-23 07:xx Launched the matrix in the background with `nohup npm run test:matrix -- --matrix=scripts/matrices/additional-models-all-toolsets.json --parallel=2`.
- 2026-04-23 07:xx Background PID was `72148`; launcher log is `.tmp/benchmark-matrix-logs/additional-models-all-toolsets.launch.log`.

## Final notes and learnings
- The new matrix is resumable because every entry has an explicit `runId` and `resume: true`.
- Re-running the same matrix file later will continue the next incomplete batch for each entry.
- Tool set `none` is being run in `closed_book`; the five tool-using sets are being run in `open_book`.
