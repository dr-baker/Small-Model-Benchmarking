# Benchmark Visualizer

Small contained frontend app for comparing benchmark execution results.

## What it does

- Upload one or more benchmark `aggregate.json` files
- Or pick one or more execution folders and auto-detect `aggregate.json`
- Compare top-level metrics across runs with a judge-first view of correctness, completeness, and reference verification
- Inspect evidence-basis breakdowns with legacy question-type compatibility
- Open every benchmark question and compare all uploaded answers side by side
- See reference answer, rubric rules, authoritative judge output, deterministic comparison/debug signals, citations, costs, and errors

## Run locally

```bash
cd tools/benchmark-visualizer
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Notes

- Data stays in browser. No server upload.
- Generated snapshot data now lives under `public/generated/` so the browser can fetch it without baking the full benchmark bundle into the main JS chunk.
- Question metadata is generated from repo benchmark assets via `npm run generate:question-bank`.
- Bundled recent runs are generated from `benchmark-results/` and prefer complete benchmark suites over smoke or partial runs.
- Best experience: upload `aggregate.json` files from directories under `benchmark-results/`.
