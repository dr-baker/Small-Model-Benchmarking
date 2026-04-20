# OpenRouter Benchmark Runs

## Goal
Run benchmark smoke checks, then larger resumable batches for Nemotron and Mercury in supported modes, and document any blockers for the requested database-assisted mode.

## TODO
- [x] Inspect benchmark mode support, model ids, and current runner constraints.
- [x] Run small smoke batches for Nemotron and Mercury in supported modes to verify collect + judge + grade wiring.
- [x] Run larger resumable batches for verified model/mode combinations, using parallel process launches where safe.
- [x] Record results, artifact paths, and any blocker for the requested database-assisted run.

## Progress Notes
- 2026-04-17 00:00 Created working plan for requested benchmark runs.
- 2026-04-17 00:10 Audited runner/config. Repo supports only `open_book` and `closed_book` modes right now; no database-assisted mode or database tool path exists in contracts, config, or collect tooling.
- 2026-04-17 00:12 First smoke attempt using CLI `--transport=openrouter` exposed runner behavior: that flag overrides judge transport too, which breaks default judge model `openai-codex/gpt-5.4` unless `--judge-model=openrouter/openai/gpt-5.4` is also supplied.
- 2026-04-17 00:18 Smoke rerun succeeded for four supported combinations using direct OpenRouter for candidate + judge override `openrouter/openai/gpt-5.4`: Nemotron open/closed and Mercury open/closed. Nemotron open-book needed 1 collect parse retry; all four runs reached aggregate successfully.
- 2026-04-17 00:55 Ran larger batch-1 executions (`batch-size=10`) for Nemotron open/closed and Mercury open/closed in parallel, each under its own resumable execution directory to avoid aggregate-file races.
- 2026-04-17 01:53 Ran larger batch-2 executions (`batch-size=10`) for the same four combinations in parallel. Then re-aggregated over all completed run directories per execution folder to get cumulative 20-question summaries, because the built-in runner only aggregates the runs completed in that specific invocation.

## Final notes and learnings
- Supported runs completed: Nemotron open_book, Nemotron closed_book, Mercury open_book, Mercury closed_book. Each has 20 completed questions so far (2 batches × 10 questions) under explicit resumable run ids in `benchmark-results/`.
- Requested database-assisted benchmark could not run because repo currently has no database-assisted mode in contracts/config/tool sets; only `open_book` and `closed_book` exist.
- CLI `--transport=openrouter` also overrides judge transport, so OpenRouter runs need judge model override `--judge-model=openrouter/openai/gpt-5.4` unless runner behavior changes.
- Current cumulative 20-question summaries: Nemotron open_book score 0.40 with 5 collect-error runs; Nemotron closed_book 0.25; Mercury open_book 0.50; Mercury closed_book 0.40.
