# Batched Resumable Benchmark Runs

## Goal
Make the benchmark ready for iterative model comparisons by fixing dataset validation, adding configurable batching and resume behavior, clarifying where models are configured, improving failure handling, and tracking costs through collect/judge/aggregate.

## TODO
- [x] Fix the dataset validation drift so `npm run dataset:validate` passes cleanly.
- [x] Add benchmark config support for explicit candidate model lists, batching, and resume behavior.
- [x] Refactor the runner to execute configurable batches, skip already-completed runs, and continue safely after cancellation or failures.
- [x] Track model costs through collect, judge, and aggregate artifacts with clear stage and total rollups.
- [x] Tighten failure modes and validation around empty / unusable model outputs.
- [x] Update docs/config comments to show the supported place to set models and how batched/resumable runs work.
- [x] Verify with build, typecheck, architecture, dataset validation, and a targeted smoke check.
- [x] Add automatic batch-number detection from existing run artifacts so the runner can pick the next incomplete batch.

## Progress Notes
- 2026-04-13: Started plan after confirming the current pipeline builds and typechecks, but dataset validation fails and existing traces show many empty or parse-failed outputs from the default model.
- 2026-04-13: Rebuilt `dataset/swiftui-docs-chatbot-benchmark.v1.json` from `dataset/source/final-qa-bank.md`, which restored `npm run dataset:validate`.
- 2026-04-13: Reworked benchmark config so `benchmark.yaml` now holds `models`, `execution`, and `batch` blocks. CLI overrides still work for one-off runs.
- 2026-04-13: Refactored `scripts/test-run.ts` to use stable per-run IDs inside an execution directory, support batch slicing, skip completed runs when `resume` is enabled, and continue through recorded collect/judge failures unless `stopOnError` is set.
- 2026-04-13: Added cost propagation from provider usage metadata through collect/judge traces into aggregate summaries. Providers that do not expose cost still aggregate cleanly with `Cost: unavailable`.
- 2026-04-13: Tightened collect validation so empty structured outputs now become parse errors instead of silently grading as empty answers.
- 2026-04-13: Verified with `npm run typecheck`, `npm run build`, `npm run check:architecture`, `npm run dataset:validate`, plus a no-cost smoke run using `bogus/test-model` + `--run-id=resume-smoke`, then reran with `--resume=true` to confirm idempotent skipping.
- 2026-04-13: Added `batch.number: auto` / `--batch-number=auto`. Auto detection scans run artifacts for the current execution directory and picks the first batch that is not fully complete for the current model+mode selection. Smoke-checked by completing batch 1, then rerunning with two questions and auto detection; it correctly selected batch 2.
- 2026-04-13: Expanded `README.md` to document the supported config location for models, explicit `runId` guidance, auto batch selection, resumability semantics, and cost/failure behavior.

## Final notes and learnings
- Resumable / idempotent runs now require a stable execution directory, so the runner derives that from an explicit `runId`; `runId: auto` still works for ad-hoc runs but is not resumable across invocations.
- Batch support is implemented as a simple slice over the selected question set (`batch.size`, `batch.number`), which keeps the config and artifacts easy to reason about. `batch.number: auto` now derives the next incomplete slice from existing `grade.json` artifacts.
- Empty schema-valid responses were a real failure mode in existing traces; treating them as parse errors makes downstream judge/grade behavior much clearer.
- Cost reporting is now useful for model comparisons, but only when the upstream provider returns cost metadata (OpenRouter does; direct provider APIs may not).
