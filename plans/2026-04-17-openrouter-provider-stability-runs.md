# OpenRouter Provider Stability Runs

## Goal
Run small verification benchmarks for `openai/gpt-oss-120b:nitro` via OpenRouter and for Nemotron without provider lock, then compare stability and artifact output for database-assisted retrieval.

## TODO
- [x] Verify exact OpenRouter model refs for `gpt-oss-120b:nitro` and unlocked Nemotron in current runner.
- [x] Run smoke benchmark for `openai/gpt-oss-120b:nitro` with `mode=open_book` and `toolSet=swift_docs_hybrid`.
- [x] Run smoke benchmark for Nemotron without provider lock with `mode=open_book` and `toolSet=swift_docs_hybrid`.
- [x] Inspect resulting traces and aggregate outputs for stability, errors, and retrieval behavior.
- [x] Summarize which configuration looks stable enough for larger batches.

## Progress Notes
- 2026-04-17 04:40 Created follow-up plan for requested OpenRouter provider comparison after merging Swift Docs hybrid benchmark support into main.
- 2026-04-17 04:43 Verified runner accepts requested refs in current `provider/model-id` format: `openrouter/openai/gpt-oss-120b:nitro` and unlocked Nemotron `openrouter/nvidia/nemotron-3-super-120b-a12b`.
- 2026-04-17 04:49 Ran 3-question `open_book + swift_docs_hybrid` smoke for `openrouter/openai/gpt-oss-120b:nitro`. All 3 runs completed without collect/judge errors and produced aggregate artifacts.
- 2026-04-17 04:49 Ran matching 3-question smoke for unlocked Nemotron `openrouter/nvidia/nemotron-3-super-120b-a12b`. All 3 runs completed without collect/judge errors and produced aggregate artifacts.
- 2026-04-17 04:53 Compared smoke outputs against earlier locked-provider Nemotron smoke. Unlocked Nemotron appears more stable operationally because it avoided the prior collect error, but answer quality stayed weak on this 3-question sample.

## Final notes and learnings
- `gpt-oss-120b:nitro` looked stable enough for larger database-assisted batches: 3/3 runs completed, grounded rate `1.00`, no recorded errors, mean score `0.33`.
- Unlocked Nemotron also looked more stable than locked `:nitro` on this smoke: 3/3 runs completed with no recorded errors, versus prior locked-provider smoke that had `1/1` collect-error runs.
- Stability improved for unlocked Nemotron, but quality still lagged badly on this sample: mean score `0.00`, one no-relevant-doc-found run, and one deprecated recommendation flag.
- Smoke execution folders:
  - `benchmark-results/swiftui-docs-chatbot-benchmark--smoke-db-gptoss120b-2026-04-17/`
  - `benchmark-results/swiftui-docs-chatbot-benchmark--smoke-db-nemo-unlocked-2026-04-17/`
