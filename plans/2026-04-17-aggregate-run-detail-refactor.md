# Aggregate Run Detail Refactor

## Goal
Refactor aggregate outputs so each execution folder has one clear place to inspect per-run question text, model answer, judge breakdown, and judge commentary, while also making CSV exports more robust for Excel.

## TODO
- [x] Audit current aggregate outputs and identify where per-run detail is missing or awkward to extract.
- [x] Design aggregate artifact shape for detailed per-run records that stays easy to inspect in JSON and CSV.
- [x] Implement aggregate refactor, including safer CSV encoding/field organization for list-like columns such as `mustMentionPassed`.
- [x] Verify by regenerating aggregate artifacts for a representative execution folder and inspecting outputs.
- [x] Summarize new artifact layout and any remaining Excel caveats.

## Progress Notes
- 2026-04-17 05:10 Started follow-up refactor after confirming `aggregate-runs.csv` lacks question text, answer text, and judge commentary, and after user flagged likely Excel pain around list-valued CSV fields.
- 2026-04-17 05:18 Chose refactor shape: keep summary outputs, but make `aggregate.json` include a top-level detailed `runs` array and add `aggregate-runs.jsonl` for one-record-per-run extraction without CSV quirks.
- 2026-04-17 05:26 Updated `src/aggregate/run.ts` to load dataset-backed question metadata from `execution-config.yaml`, fall back to collect prompts when needed, read `normalized-answer.json`, and flatten per-run question/answer/judge detail into aggregate outputs.
- 2026-04-17 05:31 Expanded `aggregate-runs.csv` with question title/text, answer fields, judge reasoning, artifact paths, and JSON-backed list columns like `mustMentionPassedJson` in addition to the old human-readable joined columns.
- 2026-04-17 05:33 Made CSV output more Excel-friendly by emitting UTF-8 BOM + CRLF line endings, and by keeping list-valued fields in explicit JSON columns instead of relying only on pipe-joined text.
- 2026-04-17 05:36 Verified with `npm run typecheck`, `npm run check:architecture`, and `npm run aggregate:run -- --execution-dir=benchmark-results/swiftui-docs-chatbot-benchmark--smoke-db-gptoss120b-2026-04-17`.

## Final notes and learnings
- `aggregate.json` is now single rich artifact for an execution folder: model summaries plus detailed per-run question, answer, grade, judge commentary, costs, and artifact paths.
- `aggregate-runs.csv` now includes question text, model answer, judge reasoning, and both joined-text and JSON-array versions of list-valued grade fields.
- `aggregate-runs.jsonl` is best machine-friendly export for downstream analysis or custom scripts; each line is one full run record from `aggregate.json.runs`.
- Excel import should be less fragile now because CSVs use UTF-8 BOM + CRLF and list-like fields have explicit JSON columns, but multiline answer/commentary cells still mean JSONL is safer for exact programmatic parsing.
