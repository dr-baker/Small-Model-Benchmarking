# Visualizer Version Picker

## Goal
Expose both visualizer implementations on the site: the current main/Claude version and the 5.5 KPI layout version, with a floating bottom-right picker that shows the active site version and switches between them.

## TODO
- [x] Preserve the current main visualizer as a named Claude version component.
- [x] Bring the 5.5 visualizer implementation from the feature worktree into main as a separate version component.
- [x] Replace the root visualizer app with a small version-switching shell and floating picker.
- [x] Ensure shared styles and generated recent-run loading support both versions from main and worktrees.
- [x] Run the visualizer build/typecheck and fix issues.
- [x] Start the combined visualizer on a comparison port.

## Progress Notes
- 2026-04-24: Starting from dirty main containing the current Claude visualizer changes, plus the feature worktree `../LLM-Benchmarking-visualizer-kpi-layout` containing the 5.5 KPI layout.
- 2026-04-24: Copied the current main visualizer into `ClaudeVisualizerApp.tsx` and the 5.5 worktree visualizer into `Gpt55VisualizerApp.tsx`.
- 2026-04-24: Replaced `App.tsx` with a version-switching shell. The picker defaults from `?viz=claude`, `?viz=5.5`, or localStorage and persists the selected version.
- 2026-04-24: Added floating bottom-right picker styles plus the 5.5 KPI/toolset-bar styles to the shared stylesheet.
- 2026-04-24: Added `BENCHMARK_RESULTS_ROOT` support to the recent-run generator for worktree previews.
- 2026-04-24: `BENCHMARK_RESULTS_ROOT="/Users/daniel/Developer/LLM Benchmarking/benchmark-results" npm run build` passes in `tools/benchmark-visualizer`.
- 2026-04-24: Started the combined site at `http://localhost:5176/` (Vite node PID 39108, launcher PID 39010, log `/tmp/benchmark-visualizer-combined-5176.log`).

## Final notes and learnings
- Both visualizers now live side-by-side behind a small root shell instead of trying to reconcile their layouts into one component. This keeps the Claude/main version and the 5.5 KPI version cleanly separable while sharing generated data, theme CSS variables, and upload behavior.
