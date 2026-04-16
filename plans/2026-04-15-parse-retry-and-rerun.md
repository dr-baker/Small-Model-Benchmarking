# Parse Retry and Failed Run Rerun

## Goal
Add configurable retry behavior for collect-stage parse failures, track how many retries were used in artifacts, rerun the already-failed runs cleanly, and then continue the benchmark efficiently.

## TODO
- [x] Inspect collect/run artifact contracts and config surfaces for the best place to add parse-retry settings and retry tracking.
- [x] Implement configurable collect parse retries and persist retry counts / retry outcomes in run artifacts.
- [x] Set the benchmark config to use 3 parse retries and verify types/config validation still pass.
- [x] Identify failed existing runs, clear only their run artifacts, and rerun them to confirm the retry behavior works.
- [x] Continue the remaining benchmark efficiently, using parallel batch assignment where safe.
- [x] Verify with typecheck and a targeted benchmark rerun.
- [ ] Resolve judge-stage quota failures so the full run has complete judge coverage.

## Progress Notes
- [2026-04-15 23:35] Created plan and started inspecting collect/config/retry handling.
- [2026-04-15 23:45] Added `execution.maxParseRetries`, collect-stage retry looping for schema parse failures, and retry metadata on `trace.json` / `manifest.json`.
- [2026-04-15 23:47] Updated `benchmark.yaml` to use 3 parse retries and re-ran `npm run typecheck` plus `npm run dataset:validate` successfully.
- [2026-04-15 23:48] Identified three failed run directories from completed batches: q17 closed-book, q18 open-book, q34 open-book.
- [2026-04-16 00:06] Cleared and reran the three failed collect runs; all three regenerated cleanly with no remaining collect parse failures.
- [2026-04-16 00:10] Finished all remaining collect+grade work by splitting the remaining 35 questions across 4 parallel workers sharing the same execution directory.
- [2026-04-16 00:11] Parse retry logic fired successfully on at least three runs (`q49` open-book, `q59` open-book, `q65` closed-book), each succeeding after 1 retry.
- [2026-04-16 00:12] Parallel judge traffic exhausted the `openai-codex/gpt-5.4` ChatGPT-backed quota in pi, leaving 58 `judge.json` artifacts with `status: error`; collect and deterministic grade artifacts are complete for all 150 runs.

## Final notes and learnings
- Added collect-stage parse retry control via `execution.maxParseRetries` and persisted retry metadata in `trace.json` / `manifest.json`.
- The targeted failed collect runs were recovered cleanly, and the new retry metadata confirmed automatic recovery on later runs.
- Parallelizing collect worked, but parallel judge traffic against the current pi-backed `openai-codex/gpt-5.4` judge exhausted external quota. Future parallel orchestration should either throttle judge concurrency or move the judge to an API-key-backed model/transport before fan-out.
