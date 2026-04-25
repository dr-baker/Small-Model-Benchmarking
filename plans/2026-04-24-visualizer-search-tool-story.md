# Visualizer Search Tool Story

## Goal
Make the benchmark visualizer share-ready by foregrounding the two core stories: which models answer documentation-search questions well, and which search/tool setup works best. The UI should replace long execution names with clear model/tool/variant labels and add graphics that compare toolsets directly, not only individual runs.

## TODO
- [x] Audit the current bundled run names, tool-set names, modes, routing tags, and thinking/search variants so the display taxonomy is explicit instead of inferred from long source names.
- [x] Add a typed display profile for each execution with separate fields for model, provider, toolset, mode, route/provider override, answer mode, and thinking/search variant.
- [x] Replace long labels in the sidebar, overview ledger, answer table, scatter legends, and callouts with the display profile: primary text should be model; secondary chips should be toolset, mode, route, and variant.
- [x] Add a toolset comparison section that groups visible executions by toolset and reports mean/median correctness, reference verification, retrieval quality, cost/question, time/question, and error rate.
- [x] Add model-vs-toolset graphics: a matrix where rows are models, columns are toolsets, and cells show correctness/correctness-score with cost/error badges.
- [x] Add a search-focused leaderboard that ranks toolsets across only corpus/search-backed questions and calls out best toolset overall, best cheap toolset, fastest acceptable toolset, and any unstable runs.
- [x] Add copy/microcopy explaining the benchmark questions the visualization answers: model skill at searching, tool quality for searching, and tradeoffs among quality/cost/time/reliability.
- [x] Verify with the bundled recent runs that the default view immediately communicates the winners without requiring hover, upload, or manual filtering.
- [x] Run `cd tools/benchmark-visualizer && npm run build` and fix any type or bundle regressions.

## Progress Notes
- [2026-04-24] Created this cleanup plan after reviewing the current visualizer structure. The app already has per-run overview rows and cost/time scatter plots, but execution identity is still centered around derived long labels and the charts compare runs rather than answering the toolset question directly.
- [2026-04-24] Started implementation with the intent to add a real execution metadata layer rather than scattering more string parsing through the React view.
- [2026-04-24] Added `ExecutionDisplayProfile` and a dedicated profile parser, then wired the UI to show model-first labels with toolset/mode/route/variant chips.
- [2026-04-24] Added a Search story section with toolset callouts, a corpus-backed toolset leaderboard, and a model-by-toolset matrix. Verified `npm run typecheck`, `npm run build`, and `cd tools/benchmark-visualizer && npm run build`.
- [2026-04-24] Confirmed the visualizer build regenerates against the bundled 48-run recent snapshot and now places winner callouts plus the toolset matrix directly after Overview.

## Final notes and learnings
- Implemented a dedicated execution metadata parser and a search-story view. Generated snapshot timestamps were restored after build verification so the diff stays focused on source changes.
