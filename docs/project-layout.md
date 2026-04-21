# Project layout

Very short map of the repo.

## Benchmark definition

- `benchmark/` — benchmark definition assets grouped by concern:
  - `dataset/` — 83-question source bank, gold evidence, metadata tags, and derived dataset JSON
  - `prompts/` — versioned collect and judge prompts
  - `tool-sets/` — named tool configurations
  - `rubric/` — deterministic grading rules only
- `corpus/` — frozen documentation snapshots and manifests
- `benchmark.yaml` — tracked base config
- `benchmark.local.yaml` — optional local overrides, gitignored

## Pipeline code

- `src/collect/` — model execution and trace capture
- `src/judge/` — LLM judge stage
- `src/grade/` — deterministic grading over saved traces
- `src/aggregate/` — execution-level summaries and comparisons
- `src/shared/` — contracts, config loading, and helpers

## Outputs and supporting docs

- `benchmark-results/` — immutable execution folders and aggregate outputs
- `docs/` — shareable setup and layout docs
- `archive/` — historical source material and early analysis snapshots
- `plans/` — implementation plans and progress logs
- `lessons/` — design notes and benchmark learnings
