# Merge Database-Assisted Benchmark Support

## Goal
Merge database-assisted benchmark support from alternate worktree into main, preserve new run-folder aggregation artifacts, and run verification tests including intended database-assisted benchmark smoke runs.

## TODO
- [x] Audit feature worktree changes for database-assisted support and overlap with current main changes.
- [x] Merge or port database-assisted code into main while preserving new execution-folder YAML/CSV aggregation refactor.
- [x] Update benchmark config/tool sets/docs needed to run database-assisted mode from main.
- [x] Run verification: typecheck and representative smoke benchmark for database-assisted path.
- [x] Summarize merged behavior, artifact locations, and any remaining gaps.

## Progress Notes
- 2026-04-17 03:20 Started merge plan for bringing database-assisted benchmark support from feature worktree into main.
- 2026-04-17 03:28 Audited `feature/swift-docs-tool-benchmark` and ported database-assisted pieces instead of doing raw git merge, because main already had overlapping runner/aggregation refactors that would have conflicted heavily.
- 2026-04-17 03:42 Merged in optional `swiftDocs` config support, `swift_docs_hybrid` tool set, hybrid search tool execution, retrieval-result parsing, judge retrieval-quality fields, and tool-set override support in `scripts/test-run.ts`.
- 2026-04-17 03:50 Updated run ids so non-default tool-set overrides get distinct per-question directories, while default tool-set runs keep old naming for resumability.
- 2026-04-17 04:00 Found and fixed a grounding/retrieval normalization bug for Swift Docs hybrid results: returned `normalized_md_path` values included the corpus-root folder name, so grade needed corpus-relative normalization before comparing to citations/gold evidence.
- 2026-04-17 04:05 Verified with `npm run typecheck` and `npm run check:architecture`.
- 2026-04-17 04:26 First database-assisted smoke proved tool execution on Mercury and Nemotron, but grounding/retrieval metrics were wrong because of the path-normalization mismatch.
- 2026-04-17 04:34 Re-ran database-assisted smoke after fix. Mercury smoke now shows `toolSet=swift_docs_hybrid`, one hybrid search call recorded, grounded `100%`, and CSV outputs in the execution folder. Nemotron smoke still reached collect but recorded a collect-stage error on this question/model combination.

## Final notes and learnings
- Database-assisted support now exists on main via `--tool-set=swift_docs_hybrid` for `open_book` runs; no separate benchmark mode enum was added.
- Effective run config and aggregate CSVs still land in each execution folder, so database-assisted runs get the same reproducible artifact layout as other runs.
- Verified smoke execution folders:
  - `benchmark-results/swiftui-docs-chatbot-benchmark--smoke-db2-mercury-2026-04-17/`
  - `benchmark-results/swiftui-docs-chatbot-benchmark--smoke-db2-nemotron-2026-04-17/`
- Mercury database-assisted smoke confirmed end-to-end hybrid retrieval execution and artifact capture. Nemotron still needs more tuning if we want stable larger hybrid batches.
