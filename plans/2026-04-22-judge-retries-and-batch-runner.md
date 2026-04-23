# Judge retries and smarter batch runner

## Goal
Add robust judge-call retries with progressive backoff, then upgrade the reusable benchmark runner so it can do a pilot batch, stop on major failures, and fall back from structured to non-structured answers when that is the main issue.

## TODO
- [x] Add configurable judge retry policy with progressive backoff and narrow retry conditions.
- [x] Wire judge retry settings through config loading and execution metadata.
- [x] Verify the judge retry changes with typecheck and commit them separately.
- [ ] Extend the benchmark runner config so runs can declare models, reasoning level, transport, tool sets, and staged batches in one file.
- [ ] Add pilot-batch validation that stops the campaign on major failures.
- [ ] Add a structured-to-lazy fallback path for entries whose pilot batch mostly fails due to answer parsing / structured-output issues.
- [ ] Verify the runner changes with typecheck and a no-op/resume validation, then commit them separately.

## Progress Notes
- [2026-04-22 06:05] Started a focused follow-up plan for two separate pieces of work so they can land as incremental commits: judge retries first, then the smarter batch runner.
- [2026-04-22 06:16] Added a dedicated `judge.retry` policy in config, threaded it through `scripts/test-run.ts`, and updated `src/judge/run.ts` to retry only retryable judge failures with exponential backoff plus small jitter. The retry notes are written into `judge.json` so later audits can see when a score survived a transient backend failure.
- [2026-04-22 06:18] Ran `npm run typecheck` cleanly after the judge-retry changes. I left the retry scope intentionally narrow: transient backend call failures and no-final-text judge responses retry, but a stable malformed JSON response does not.

## Final notes and learnings
- In progress.
