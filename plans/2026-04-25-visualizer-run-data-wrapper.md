# Visualizer Run Data Wrapper

## Goal
Create a cleaner generated benchmark-run data structure for visualizers, with Toolset as a first-class concept and aggregate run numbers precomputed once instead of recomputed throughout the UI.

## TODO
- [x] Inspect current visualizer data generation and runtime aggregation paths.
- [x] Design a generated benchmark run shape that includes model/profile/toolset/corpus/question counts and aggregate metrics.
- [x] Add or update a wrapper script to generate the normalized run data.
- [x] Update visualizer code to consume the normalized run/toolset structure and remove open/closed-book framing where possible.
- [x] Run typecheck/build verification.

## Progress Notes
- 2026-04-25: Started by locating visualizer files and project scripts.
- 2026-04-25: Reworked `generate-recent-runs.mjs` so each bundled entry now contains a first-class `benchmarkRun` wrapper with model, toolset, transport, corpus, and precomputed metric fields.
- 2026-04-25: Added shared visualizer types for `BenchmarkRunProfile`, `BenchmarkRunMetrics`, and `ToolsetProfile`; the loader now prefers bundled benchmark-run wrappers and still accepts legacy aggregate uploads.
- 2026-04-25: Updated labels to make toolsets first-class with icons and removed open/closed-book chips from primary run labels.
- 2026-04-25: Verified with `cd tools/benchmark-visualizer && npm run build` and root `npm run build`.

## Final notes and learnings
- Shipped a generated benchmark-run wrapper while preserving the underlying aggregate JSON for detailed question review and backwards-compatible uploads.
- Toolset now carries key/label/icon/version/tools through `LoadedExecution`, making UI code less dependent on mode/open-book terminology.
