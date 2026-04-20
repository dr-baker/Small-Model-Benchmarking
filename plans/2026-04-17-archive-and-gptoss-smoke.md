# Archive Old Artifacts and Run GPT-OSS Smoke

## Goal
Archive superseded benchmark artifacts, then run a small parallel smoke benchmark for `openrouter/openai/gpt-oss-120b:nitro` across closed-book, open-book, and database-assisted open-book modes.

## TODO
- [x] Audit current benchmark execution folders and identify old artifacts to archive before new smoke runs.
- [x] Archive selected old artifacts into a clear timestamped location without deleting benchmark data.
- [x] Run GPT-OSS smoke tests in parallel for closed_book, open_book, and open_book + `swift_docs_hybrid`.
- [x] Inspect aggregate outputs and errors for the three smoke runs.
- [x] Summarize archive location, commands used, and smoke results.

## Progress Notes
- 2026-04-17 05:45 Started follow-up task to archive old artifacts and run a fresh GPT-OSS parallel smoke matrix.
- 2026-04-17 05:48 Audited `benchmark-results/`. Chose to archive prior GPT-OSS db-only smoke execution folder `swiftui-docs-chatbot-benchmark--smoke-db-gptoss120b-2026-04-17/` so fresh open/closed/db smoke outputs have cleaner top-level artifact set without deleting any historical data.
- 2026-04-17 05:50 Archived that execution folder under `benchmark-results/archive/2026-04-17-gptoss-smoke-refresh/`.
- 2026-04-17 05:55 Ran 3-question GPT-OSS smoke in parallel for `closed_book`, default `open_book` (`read_grep`), and database-assisted `open_book + swift_docs_hybrid`, all with OpenRouter judge override `openrouter/openai/gpt-5.4`.
- 2026-04-17 05:58 All three smoke jobs completed without recorded collect/judge errors. Default open-book had one collect parse retry on q03 but recovered within retry budget.
- 2026-04-17 06:00 Smoke summary: default open-book strongest on this sample (`0.67` deterministic score, `1.00` MRR), closed-book weakest (`0.00`), db-assisted in middle on score (`0.33`) but notably worse than default open-book on judge verdicts and cost due to heavier judge prompts.
- 2026-04-17 06:05 User clarified archive scope: archive everything in `benchmark-results/` except recent GPT-OSS smoke runs, while keeping archived history under `benchmark-results/archive/`.

## Final notes and learnings
- Archive locations:
  - previous GPT-OSS db smoke: `benchmark-results/archive/2026-04-17-gptoss-smoke-refresh/swiftui-docs-chatbot-benchmark--smoke-db-gptoss120b-2026-04-17/`
  - bulk top-level cleanup: `benchmark-results/archive/2026-04-17-pre-gptoss-smoke-top-level-cleanup/`
- Remaining top-level execution folders intentionally kept live:
  - `benchmark-results/swiftui-docs-chatbot-benchmark--smoke-gptoss-open-2026-04-17/`
  - `benchmark-results/swiftui-docs-chatbot-benchmark--smoke-gptoss-closed-2026-04-17/`
  - `benchmark-results/swiftui-docs-chatbot-benchmark--smoke-gptoss-db-2026-04-17/`
- 3-question smoke results:
  - open_book `read_grep`: score `0.67`, grounded `1.00`, MRR `1.00`, total cost `$0.0379`
  - closed_book `none`: score `0.00`, total cost `$0.0170`
  - open_book `swift_docs_hybrid`: score `0.33`, grounded `1.00`, total cost `$0.0686`
- On this small sample, GPT-OSS used default corpus search better than current DB-assisted path. Worth inspecting retrieval/query behavior before scaling hybrid runs.
