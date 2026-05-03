# Promote Visualizer App

## Goal
Make the benchmark visualizer a first-class app in the repository that can load the full existing benchmark results without rerunning collection.

## TODO
- [x] Move the visualizer from `tools/benchmark-visualizer` to `apps/visualizer`.
- [x] Update visualizer scripts and path assumptions for the new app location.
- [x] Add root npm scripts for generating, developing, building, and previewing the visualizer.
- [x] Update documentation references from the tools path to the app path.
- [x] Run build/typecheck verification for the visualizer and root project.

## Progress Notes
- 2026-05-01: Started promotion work after deciding the visualizer should be a first-rate app rather than an internal tool.
- 2026-05-01: Moved `tools/benchmark-visualizer` to `apps/visualizer` with `git mv`.
- 2026-05-01: Updated root scripts, `make viz`, app README, root README, and Vite relative asset base for the promoted app path.
- 2026-05-01: Verified `npm run visualizer:build` and root `npm run build`; the visualizer bundled 63 benchmark runs from existing results.
- 2026-05-01: Added `build:static` scripts so hosted builds can package already-generated JSON without trying to rescan gitignored local `benchmark-results/` directories.

## Final notes and learnings
- Promoted the visualizer to `apps/visualizer`, added root commands, and kept generated data sourced from existing `benchmark-results/` without rerunning benchmarks.
- Vite now uses `base: './'` so built assets are portable across static hosts and subpaths.
- Hosted deployments should use the static build when `benchmark-results/` is not available in the Vercel checkout; regenerate and commit `apps/visualizer/public/generated/*.json` locally when results change.
