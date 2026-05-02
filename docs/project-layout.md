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

- `src/pipeline/collect/` — model execution and trace capture
- `src/pipeline/judge/` — LLM judge stage
- `src/pipeline/grade/` — deterministic grading over saved traces
- `src/pipeline/aggregate/` — execution-level summaries and comparisons
- `src/core/` — contracts, config loading, JSON, IO, corpus paths, and pure helpers
- `src/llm/` — provider auth, response schemas, and the LLM client

## Scripts

- `scripts/run/` — main run and aggregation entrypoints
- `scripts/dataset/` — dataset build and validation scripts
- `scripts/checks/` — architecture checks
- `scripts/smoke/` — focused smoke tests
- `scripts/models/` — model watching helpers
- `scripts/matrices/` — benchmark matrix definitions

## Outputs and supporting docs

- `benchmark-results/` — immutable execution folders and aggregate outputs
- `docs/` — shareable setup and layout docs
- `archive/` — historical source material and early analysis snapshots
- `plans/` — implementation plans and progress logs
- `lessons/` — design notes and benchmark learnings
