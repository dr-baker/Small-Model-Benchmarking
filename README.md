# SwiftUI Docs Chatbot Benchmark

A reproducible benchmark for testing LLM-powered SwiftUI docs assistants against a curated **83-question** dataset of modern SwiftUI QA tasks.

It can run models in closed-book mode, corpus-backed open-book mode, or optional local Swift Docs hybrid-search mode, then score and compare them with a trace-first pipeline:

**collect → judge → grade → aggregate**

## What it can do

- Benchmark candidate models across the same 83-question dataset
- Compare open-book vs. closed-book behavior and different tool sets
- Capture immutable per-run artifacts: prompts, tool calls, traces, normalized answers, judge outputs, costs, and manifests
- Re-grade or re-aggregate from saved traces without recollecting runs
- Produce execution-level rollups in JSON and CSV for analysis

## Quickstart

```bash
npm install
cp .env.example .env
# add provider API keys

npm run dataset:validate
npm run test:run -- --run-id=pilot-v1 --resume=true --batch-size=10 --batch-number=auto
```

Before running, review `benchmark.yaml` to choose models, modes, and batching.

Use the tracked `benchmark.yaml` for shared defaults. If you want local Swift Docs hybrid retrieval, add a gitignored `benchmark.local.yaml` with your machine-specific `swiftDocs` paths.

Each execution writes to `benchmark-results/<benchmark-name>--<run-id>/` and includes aggregate outputs such as:

- `aggregate.json`
- `aggregate-summary.csv`
- `aggregate-evidence-basis.csv`
- `aggregate-runs.csv`
- `aggregate-runs.jsonl`

## Key commands

```bash
npm run build
npm run typecheck
npm run check:architecture
npm run dataset:build
npm run dataset:validate
npm run test:run
npm run aggregate:run -- --run-id=<run-id>
```

## Where to look next

- `docs/local-setup.md` — local env setup and `benchmark.local.yaml`
- `docs/project-layout.md` — repo map and directory purpose
- `benchmark.yaml` — base benchmark config
- `benchmark/` — dataset, gold evidence, prompts, tool sets, and rubric
- `plans/` and `lessons/` — deeper implementation notes and findings
