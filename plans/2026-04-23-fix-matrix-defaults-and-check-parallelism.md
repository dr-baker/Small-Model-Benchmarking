# Fix Matrix Defaults And Check Parallelism

## Goal
Make the matrix runner default to the intended full benchmark question set, add bounded per-question concurrency with staggered starts and smarter collect retries, and make the benchmark runner queue all incomplete batches by default.

## TODO
- [x] Inspect the active benchmark config merge inputs to confirm why the recent matrix ran only one question.
- [x] Update the runner/config behavior so full-benchmark matrix runs default to the full question set unless explicitly narrowed.
- [x] Verify the updated behavior with a lightweight matrix/config check.
- [x] Inspect the benchmark harness execution flow and summarize where parallelism does and does not exist.
- [x] Add bounded question-level concurrency in `scripts/test-run.ts` with staggered collect starts.
- [x] Add progressive collect retry handling for transient/rate-limit errors.
- [x] Change the default batch behavior so one invocation queues all incomplete batches instead of only the next batch.
- [x] Verify the new default-all-batches behavior against an existing run directory.
- [x] Run a smoke test that exercises the new question concurrency/all-batches path.
- [x] Resume the additional-model all-toolsets matrix with high outer parallelism after the smoke passes.
- [x] Fix the matrix-runner observability issue that made active runs look stalled.
- [x] Run a matrix-level smoke test to verify live log streaming before relaunching the big sweep.
- [x] Relaunch the additional-model all-toolsets matrix after the matrix-runner fix.

## Progress Notes
- 2026-04-23 07:xx Plan created after the partial one-question matrix run revealed an unexpected default question selection.
- 2026-04-23 07:xx Confirmed `benchmark.local.yaml` was not narrowing questions; the real bug was in `scripts/run-benchmark-matrix.ts`, which defaulted `batchSize` to `1` whenever the matrix entry did not specify questions or a batch size.
- 2026-04-23 07:xx Updated `buildCommandArgs(...)` so the runner only passes `--batch-size` and `--batch-number` when they are explicitly implied by the matrix entry/defaults, instead of forcing `--batch-size=1 --batch-number=1`.
- 2026-04-23 07:xx Verified the first fix with a lightweight matrix run against an existing completed execution: the spawned `test:run` command omitted batch flags, and the harness correctly fell back to config-driven batching (`Batch 9 with size 10. (auto-detected)`).
- 2026-04-23 07:xx Confirmed the pre-change concurrency model: the matrix runner parallelized across entries/processes only; each spawned `test:run` invocation processed its selected questions serially, and within each question the collect → judge → grade stages also ran serially.
- 2026-04-23 08:xx Added `execution.questionConcurrency`, `execution.questionStartSpacingMs`, and `execution.collectRetry` to the benchmark config surface. Defaulted them in `benchmark.yaml` to question concurrency `5`, spacing `750ms`, and a progressive outer collect retry policy.
- 2026-04-23 08:xx Reworked `scripts/test-run.ts` so it now resolves the selected batch set up front, builds run work items across those questions, and executes them with a bounded worker pool instead of a purely serial nested loop.
- 2026-04-23 08:xx Added a collect-start limiter that staggers new collect calls so parallel workers do not all hit OpenRouter at once, plus transient collect retries that back off progressively when the trace error looks like a rate limit, timeout, or provider-side server failure.
- 2026-04-23 08:xx Kept existing inner OpenRouter request retries and also taught `src/shared/llm-client.ts` to honor `Retry-After` headers when the provider sends them.
- 2026-04-23 08:xx Expanded `BenchmarkBatchNumber` to support `all` and changed `benchmark.yaml` default `batch.number` from `auto` to `all`, so a plain `npm run test:run` now queues every incomplete batch in one invocation by default.
- 2026-04-23 08:xx Verified the new default with an existing complete Qwen execution: `test:run` selected `0` questions, reported `No incomplete batches remain for size 10.`, and still regenerated aggregate artifacts successfully.
- 2026-04-23 08:xx `npm run typecheck` passes after the concurrency and config changes.
- 2026-04-23 08:xx Ran smoke test `npm run test:run -- --run-id=concurrency-all-batches-smoke --model=openrouter/inception/mercury-2 --mode=open_book --tool-set=read_grep --question=q01-tab-definition,q07-rounding-corners-on-a-container,q18-formatting-dates-for-display --batch-size=2 --batch-number=all --resume=false`.
- 2026-04-23 08:xx Smoke passed: it selected both batches, launched three question pipelines under the new worker pool, and showed staggered collect delays of about `749ms` and `1499ms` for later starts before completing aggregate successfully.
- 2026-04-23 08:xx Relaunched `scripts/matrices/additional-models-all-toolsets.json` in the background with higher outer parallelism via `nohup npm run test:matrix -- --matrix=scripts/matrices/additional-models-all-toolsets.json --parallel=6 > .tmp/benchmark-matrix-logs/additional-models-all-toolsets.resume.log 2>&1 &`.
- 2026-04-23 08:xx Used `--parallel=6` as the aggressive outer setting because each `test:run` process now also has internal question concurrency `5`; this still creates a high overall request rate without the truly reckless `24 × 5` fanout.
- 2026-04-23 08:xx Background launcher PID was `21690`; active spawned `test:run` processes confirmed the new invocation no longer passes `--batch-size`/`--batch-number` explicitly, so entries are using the new default `batch.number: all` behavior.
- 2026-04-24 01:42 Diagnosed the apparent “stuck” rerun as a matrix-runner observability problem: `scripts/run-benchmark-matrix.ts` buffered child stdout/stderr and only wrote the per-entry log file when the child exited, so active long-running entries looked frozen from the outside even while they were still working.
- 2026-04-24 01:42 Updated the matrix runner to stream child stdout/stderr into each per-entry log file live and to print the live log path as soon as an entry starts.
- 2026-04-24 01:42 Ran matrix-level smoke test from `.tmp/matrix-live-log-smoke.json`; within about 2 seconds the live per-entry log already contained active `test:run` output through the collect/judge stages, and the smoke matrix completed successfully.
- 2026-04-24 01:43 Killed the earlier background matrix and relaunched the additional-model sweep to pick up the live-log fix: `nohup npm run test:matrix -- --matrix=scripts/matrices/additional-models-all-toolsets.json --parallel=6 > .tmp/benchmark-matrix-logs/additional-models-all-toolsets.resume2.log 2>&1 &`.
- 2026-04-24 01:43 Confirmed the relaunched run is progressing via live child logs, for example `.tmp/benchmark-matrix-logs/qwen3-next-80b-a3b-thinking-closed.log` now shows active skip/collect/judge/grade output while the matrix is still running.

## Final notes and learnings
- The one-question behavior came from the matrix runner, not from local config overrides.
- The benchmark runner now has bounded internal question parallelism and defaults to processing all incomplete batches in one invocation.
- To avoid a thundering herd after enabling all-batches-at-once, the implementation uses a global question worker pool plus staggered collect starts and progressive retry/backoff instead of unconstrained per-batch fanout.
- The main issue behind the earlier “still running?” uncertainty was observability, not necessarily a dead stop: the matrix runner now writes live per-entry logs so we can tell the difference.
- The additional-model matrix is now back in flight under the new defaults and should continue filling the partially-started run directories instead of appearing stalled at `q01`.
