# Judge retries and smarter batch runner

## Goal
Add robust judge-call retries with progressive backoff, then upgrade the reusable benchmark runner so it can do a pilot batch, stop on major failures, and fall back from structured to non-structured answers when that is the main issue.

## TODO
- [x] Add configurable judge retry policy with progressive backoff and narrow retry conditions.
- [x] Wire judge retry settings through config loading and execution metadata.
- [x] Verify the judge retry changes with typecheck and commit them separately.
- [x] Extend the benchmark runner config so runs can declare models, reasoning level, transport, tool sets, and staged batches in one file.
- [x] Add pilot-batch validation that stops the campaign on major failures.
- [x] Add a structured-to-lazy fallback path for entries whose pilot batch mostly fails due to answer parsing / structured-output issues.
- [x] Verify the runner changes with typecheck and a no-op/resume validation, then commit them separately.

## Progress Notes
- [2026-04-22 06:05] Started a focused follow-up plan for two separate pieces of work so they can land as incremental commits: judge retries first, then the smarter batch runner.
- [2026-04-22 06:16] Added a dedicated `judge.retry` policy in config, threaded it through `scripts/test-run.ts`, and updated `src/judge/run.ts` to retry only retryable judge failures with exponential backoff plus small jitter. The retry notes are written into `judge.json` so later audits can see when a score survived a transient backend failure.
- [2026-04-22 06:18] Ran `npm run typecheck` cleanly after the judge-retry changes. I left the retry scope intentionally narrow: transient backend call failures and no-final-text judge responses retry, but a stable malformed JSON response does not.
- [2026-04-22 06:34] Reworked `scripts/run-benchmark-matrix.ts` into a staged runner that can keep model/transport/tool-set config in one JSON file, inherit defaults into phases, inspect the just-finished batch through `execution-config.yaml` + `aggregate-runs.jsonl`, and stop the campaign when error rates cross configured thresholds.
- [2026-04-22 06:36] Added structured-output fallback logic for staged runs: if a pilot batch is mostly answer-parse failures with low other collect/judge error rates, later phases can automatically switch that entry to `lazy_text` and move it onto a separate `-lazy` run id.
- [2026-04-22 06:38] Verified the runner changes with `npm run typecheck` and a resume-based replay of `scripts/matrices/search-read-multiquery-smoke.json`. The old single-phase matrix format still works, and the runner now prints the phase question slice and active answer-collection mode for each completed entry.

## Final notes and learnings
- The judge path now retries transient failures instead of turning one backend blip into a permanent `judge.json` error.
- The matrix runner can now act like a campaign runner: do a pilot phase, inspect the results, stop on serious failure rates, and downgrade structured collection to lazy text when the pilot suggests the model is mostly failing the answer contract rather than the task itself.
