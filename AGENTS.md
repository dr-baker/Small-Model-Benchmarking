# How to Work With This Codebase

Four-stage pipeline (collect → judge → grade → aggregate). Only collect/judge call models. Grade and aggregate stay pure over traces.

## Core Commands

```bash
npm run build
npm run typecheck
npm run check:architecture
npm run dataset:build
npm run dataset:validate
npm run test:run
npm run aggregate:run
```

## Directory Purpose

- `corpus/` — Frozen doc snapshots (manifests tracked)
- `benchmark/` — Benchmark definition assets (dataset, gold evidence, prompts, tool sets, rubric)
- `docs/` — Shareable usage and layout docs
- `src/collect/` — Trace collection
- `src/judge/` — LLM judge stage
- `src/grade/` — Pure deterministic grading
- `src/aggregate/` — Reports and comparisons
- `src/shared/` — Contracts and helpers
- `benchmark-results/` — Immutable run outputs
- `plans/` — Project plans
- `lessons/` — Design insights and model failures

## Key Rules

- Runs write immutable timestamped dirs under `benchmark-results/`
- Traces capture full prompts, tool payloads, events, costs, manifests
- New rubrics or judges never force re-collect
- Use `scripts/test-run.ts` for local testing

See `README.md` for the repo pitch and quickstart.
Read `docs/` for shareable setup details, then `plans/` and `lessons/` for deep detail.
