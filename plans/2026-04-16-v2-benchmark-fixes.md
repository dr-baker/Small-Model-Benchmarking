# V2 benchmark fixes

## Goal
Make the benchmark trustworthy by sandboxing collect/judge to the corpus, normalizing corpus paths, improving deterministic grading, and separating corpus-backed questions from policy-style questions.

## TODO
- [x] Add a plan-aligned question classification field to the dataset and propagate it through the pipeline.
- [x] Hard-sandbox collect and judge tools to corpus-only paths and normalize citation paths against the corpus root.
- [x] Fix retrieval and groundedness evaluation to compare normalized corpus-relative paths.
- [x] Improve deterministic grading so deprecated APIs mentioned as warnings do not automatically fail the answer.
- [x] Update aggregate reporting to show results by question classification.
- [x] Rebuild generated benchmark artifacts that depend on the changed dataset schema.
- [x] Run build, typecheck, dataset validation, and architecture checks.
- [ ] Split the work into focused commits and commit each group.

## Progress Notes
- 2026-04-16 09:10 Started implementation on branch `v2-fixes` after auditing leakage, path mismatches, and grading brittleness.
- 2026-04-16 09:32 Added corpus-path normalization, corpus-only tool sandboxing, prompt tightening, dataset question classification, deterministic grading heuristics for warning-only legacy mentions, and aggregate breakdowns by question type.
- 2026-04-16 09:35 Rebuilt the dataset and passed `build`, `typecheck`, `dataset:validate`, and `check:architecture`.
- 2026-04-17 01:30 Smoke test hit transient OpenRouter 429s on Nemotron, so I added bounded retry/backoff for retryable OpenRouter errors before attempting larger batches.
- 2026-04-17 01:34 Removed the global `deepinfra/bf16` routing pin from `benchmark.yaml`; it was breaking non-DeepInfra models entirely and keeping Nemotron stuck on the most failure-prone provider path.

## Final notes and learnings
- Pending.
