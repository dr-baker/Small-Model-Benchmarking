# Run Layout and Aggregation Refactor

## Goal
Find whether database-assisted benchmark support exists in another branch or worktree, then refactor benchmark execution so each run uses a YAML config copied into its own artifact folder and emits richer aggregate outputs including CSV score breakdowns.

## TODO
- [x] Inspect other branch/worktree for database-assisted benchmark support and document what exists.
- [x] Audit current runner, config loading, and artifact layout to define minimal refactor shape.
- [x] Implement proper aggregate/report script that emits JSON and CSV score breakdowns into each execution folder.
- [x] Refactor run layout so execution config YAML is stored with artifacts and runner metadata is more self-contained.
- [x] Verify with typecheck and a representative aggregate run.

## Progress Notes
- 2026-04-17 02:10 Started refactor plan after confirming current repo/worktree layout and user goals.
- 2026-04-17 02:18 Audited alternate worktree `feature/swift-docs-tool-benchmark`. It already contains database-assisted groundwork: optional `swiftDocs` config in `benchmark.yaml`, `SwiftDocsToolConfig` in contracts/config, hybrid-search collect tool wiring, judge/grade parsing for `swift_docs_search_hybrid`, and benchmark runner changes. Current `main` worktree does not have those files yet.
- 2026-04-17 02:35 Added execution-folder artifact snapshots on `main`: runner now writes `execution-config.yaml` plus `execution-metadata.json` into each execution directory before collect/judge/grade work.
- 2026-04-17 02:48 Added aggregate CSV outputs in `src/aggregate/run.ts`: `aggregate-summary.csv`, `aggregate-question-types.csv`, and `aggregate-runs.csv`, alongside `aggregate.json`.
- 2026-04-17 02:55 Added `scripts/aggregate-run.ts` plus npm script `aggregate:run` so existing execution folders can be re-aggregated without rerunning collect/judge.
- 2026-04-17 03:00 Updated runner aggregation to scan the full execution directory for completed runs, fixing earlier partial-invocation aggregation behavior.
- 2026-04-17 03:05 Verified with `npm run typecheck` and `npm run aggregate:run -- --run-id=mercury-open-book-v1`.

## Final notes and learnings
- Database-assisted benchmark support does exist, but only in alternate worktree/branch `feature/swift-docs-tool-benchmark`; it is not present on `main`.
- Execution folders now carry enough metadata to reproduce analysis later without reconstructing giant CLI commands.
- Aggregation is more useful when it emits both machine-friendly JSON and flat CSV tables for summaries, question types, and per-run score components.
