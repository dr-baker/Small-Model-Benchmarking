# Visualizer Search Tool Story

## Goal
Make the benchmark visualizer share-ready by foregrounding the two core stories: which models answer documentation-search questions well, and which search/tool setup works best. The UI should replace long execution names with clear model/tool/variant labels and add graphics that compare toolsets directly, not only individual runs.

## TODO
- [ ] Audit the current bundled run names, tool-set names, modes, routing tags, and thinking/search variants so the display taxonomy is explicit instead of inferred from long source names.
- [ ] Add a typed display profile for each execution with separate fields for model, provider, toolset, mode, route/provider override, answer mode, and thinking/search variant.
- [ ] Replace long labels in the sidebar, overview ledger, answer table, scatter legends, and callouts with the display profile: primary text should be model; secondary chips should be toolset, mode, route, and variant.
- [ ] Add a toolset comparison section that groups visible executions by toolset and reports mean/median correctness, reference verification, retrieval quality, cost/question, time/question, and error rate.
- [ ] Add model-vs-toolset graphics: a matrix where rows are models, columns are toolsets, and cells show correctness/correctness-score with cost/error badges.
- [ ] Add a search-focused leaderboard that ranks toolsets across only corpus/search-backed questions and calls out best toolset overall, best cheap toolset, fastest acceptable toolset, and any unstable runs.
- [ ] Add copy/microcopy explaining the benchmark questions the visualization answers: model skill at searching, tool quality for searching, and tradeoffs among quality/cost/time/reliability.
- [ ] Verify with the bundled recent runs that the default view immediately communicates the winners without requiring hover, upload, or manual filtering.
- [ ] Run `cd tools/benchmark-visualizer && npm run build` and fix any type or bundle regressions.

## Progress Notes
- [2026-04-24] Created this cleanup plan after reviewing the current visualizer structure. The app already has per-run overview rows and cost/time scatter plots, but execution identity is still centered around derived long labels and the charts compare runs rather than answering the toolset question directly.

## Final notes and learnings
- Pending implementation.
