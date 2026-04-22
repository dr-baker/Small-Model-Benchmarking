# New OpenRouter Model Open-Book Sweep

## Goal
Benchmark the requested new OpenRouter models on the refreshed SwiftUI benchmark in a way that uses concurrency carefully, monitors batch health, and stops weak runs before burning through the full sweep.

## TODO
- [x] Define the execution strategy and explicit run ids for the requested OpenRouter models.
- [x] Launch canary batch runs with safe concurrency and provider-aware staggering.
- [x] Add a lightweight monitor script so batch health can be checked quickly while the controller runs.
- [ ] Monitor batch health and continue only the models that stay within acceptable error/judge-coverage thresholds.
- [ ] Summarize which models were promoted to full runs, which were stopped early, and why.
- [ ] Update the plan with the actual thresholds, progress, and outcomes.

## Progress Notes
- [2026-04-22 03:20] Created the plan. Defaulting to open-book `read_grep` first so we can screen these five new models quickly before deciding whether any deserve the more expensive closed-book or DB-assisted lanes.
- [2026-04-22 03:58] Defined the staged sweep around explicit open-book run ids: `trinity-mini-open-2026-04-22`, `qwen3-next-80b-a3b-thinking-open-2026-04-22`, `gemini-2-5-flash-lite-open-2026-04-22`, `grok-4-fast-open-2026-04-22`, and `grok-4-1-fast-open-2026-04-22`.
- [2026-04-22 03:58] Launched a background controller at `/tmp/new-model-sweep/launch.sh` with max concurrency 3 and an x-ai provider lock so `grok-4-fast` and `grok-4.1-fast` never overlap.
- [2026-04-22 03:58] The controller advances one 10-question batch at a time with `--batch-number=auto --resume=true` and gates a model off if a batch adds more than 15% errored runs or drops below 85% judge coverage. Status files are written to `/tmp/new-model-sweep/status/` and detailed logs to `/tmp/new-model-sweep/logs/`.
- [2026-04-22 04:02] First wave started cleanly for Trinity Mini, Qwen 3 Next Thinking, and Gemini 2.5 Flash Lite. Trinity Mini is already showing early collect errors in batch 1, which is exactly the kind of signal the controller is meant to catch before promoting a model through all 83 questions.
- [2026-04-22 04:06] Added `scripts/watch-new-model-sweep.mjs` plus `npm run models:watch` so the launcher/status files can be watched in one table, with optional `--watch` refresh mode for live monitoring.

## Final notes and learnings
- Pending.
