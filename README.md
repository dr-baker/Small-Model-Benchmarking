# Small Model Benchmarking

A benchmark for testing how well small language models can search a corpus to avoid falling into common training-data pitfalls. 

The current dataset has 83 SwiftUI QA tasks and supports closed-book runs, corpus-backed runs, and several tool sets.

View results and more information here: https://small-model-benchmarking.vercel.app/

Run the first-class local visualizer with:

```bash
npm run visualizer:dev
```

The visualizer lives in `apps/visualizer` and bundles existing data from `benchmark-results/`.

## What it shows

- Which small models know modern SwiftUI?
- Does retrieval help, or does it make the answer worse?
- Which models use evidence instead of guessing?
- Did a prompt, tool set, or rubric change actually improve the result?

Each run saves prompts, tool calls, retrieved evidence, answers, judge outputs, costs, manifests, and aggregate CSV/JSON reports under `benchmark-results/`.

## Quickstart

```bash
npm install
cp .env.example .env
# add provider API keys to .env

npm run dataset:validate
npm run test:run -- --run-id=pilot-v1 --resume=true --batch-size=10 --batch-number=auto
```

Review `benchmark.yaml` before running to choose models, modes, batching, prompts, and tool sets.

To aggregate an existing run:

```bash
npm run aggregate:run -- --run-id=<run-id>
```

## Local Swift Docs search

Use the tracked `benchmark.yaml` for shared defaults. For local Swift Docs hybrid retrieval, create a gitignored `benchmark.local.yaml` with your machine-specific `swiftDocs` paths.

See `docs/local-setup.md` for setup details.

## Useful links

- `docs/local-setup.md`: local setup and Swift Docs retrieval
- `docs/project-layout.md`: repo layout
- `benchmark.yaml`: base benchmark config
- `benchmark/`: dataset, gold evidence, prompts, tool sets, and rubric
- `plans/` and `lessons/`: deeper notes and findings
