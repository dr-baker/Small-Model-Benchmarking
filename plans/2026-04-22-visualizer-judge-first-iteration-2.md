# Visualizer Judge-First Iteration 2

## Goal
Reshape the benchmark visualizer around the authoritative judge model, improve how the content explains and surfaces judge-driven results, and reduce the production bundle size so the app loads more cleanly.

## TODO
- [x] Audit the current visualizer UI structure and data-loading path to find the biggest content and bundle issues.
- [x] Refactor the visualizer content hierarchy so the overview and question detail views focus more clearly on judge correctness, completeness, reference verification, and benchmark caveats.
- [x] Reduce the bundle size by moving large generated data out of the main JS bundle and code-splitting any heavy UI that should not block first paint.
- [x] Regenerate visualizer assets and verify the build output after the restructuring.
- [x] Commit the visualizer iteration in separate logical commits with Daniel-style messages.

## Progress Notes
- [2026-04-22 01:35] Created the plan for a second visualizer pass focused on judge-first presentation and bundle size after the first judge-first site version landed and the bundle warning remained.
- [2026-04-22 01:48] Audited the current app and found two main issues: the UI still mixed debug metrics too high in the reading order, and importing generated JSON into `src/` was inflating the main bundle.
- [2026-04-22 02:05] Reshaped the content around a clearer judge-first reading flow: added a scoring-model explainer, moved overview emphasis to judge outcome/coverage/run health, and rewrote question review copy so judge interpretation leads and deterministic grading reads as comparison/debug context.
- [2026-04-22 02:16] Moved generated snapshot assets from `src/generated/` to `public/generated/`, switched the app to async-fetch the bundled snapshot, and lazy-loaded the markdown renderer so large benchmark data and markdown parsing no longer sit in the main JS chunk.
- [2026-04-22 02:19] Rebuilt the visualizer. The app now emits a split bundle with a ~241 kB main JS chunk plus a lazy markdown chunk, down from the prior monolithic multi-megabyte bundle.
- [2026-04-22 02:27] Committed the code pass as `reshaped the visualizer around judge-first review` after confirming the new async snapshot loading, judge-first content hierarchy, and split build output.

## Final notes and learnings
- The biggest bundle win came from moving generated benchmark JSON out of `src/` and fetching it from `public/generated/` at runtime.
- A small lazy-loaded markdown component was enough to keep the heavy answer/reference rendering path off the critical chunk.
- The visualizer reads more cleanly when judge coverage and judge caveats are surfaced alongside correctness and completeness instead of burying them under debug metrics.
