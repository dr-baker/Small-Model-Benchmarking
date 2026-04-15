# How to Work With This Codebase

Three-stage pipeline (collect → judge → grade → aggregate). Only collect/judge call models. Grade and aggregate stay pure over traces.

## Core Commands

```bash
npm run build
npm run typecheck
npm run check:architecture
npm run dataset:build
npm run dataset:validate
npm run test:run
```

## Directory Purpose

- `corpus/` — Frozen doc snapshots (manifests tracked)
- `dataset/` — Benchmark questions + gold evidence
- `prompts/` — Versioned prompts
- `tool-sets/` — Named tool configs
- `rubric/` — Deterministic grading rules
- `judges/` — Judge profiles
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

See `README.md` for goals and results.
Read `plans/` and `lessons/` for deep detail.
