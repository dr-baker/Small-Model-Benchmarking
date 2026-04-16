# Independent test and judge config

## Goal
Make the benchmark setup explicit about independent candidate and judge model settings, then verify a smoke run where both the test model and the judge use pi sessions with medium thinking.

## TODO
- [x] Review the current config surface for candidate versus judge model and transport settings.
- [x] Update the benchmark config and docs so the first real run uses medium thinking for both candidate and judge.
- [x] Run a smoke test and inspect artifacts to confirm the candidate and judge both use the intended model and transport settings.
- [x] Summarize the exact first-run configuration and any important caveats.

## Progress Notes
- 2026-04-15 22:58: Created plan file for making the candidate and judge setup explicit and verifying a medium-thinking smoke test.
- 2026-04-15 23:00: Confirmed the config surface already separates candidate and judge settings: candidate model(s) live under `models.candidates`, candidate transport/thinking live under top-level `transport`, judge model lives under `judge.model`, and judge transport/thinking live under `judge.transport`.
- 2026-04-15 23:02: Updated `benchmark.yaml` so the first real run uses pi transport with `thinkingLevel: medium` for the candidate as well as the judge. Updated README wording and example to make the independent candidate-versus-judge thinking settings explicit.
- 2026-04-15 23:05: Ran `npm run test:run -- --run-id=smoke-verify-both-medium --question=q01-tab-definition --mode=open_book --batch-size=1 --batch-number=1 --resume=false` and verified artifacts show candidate `openrouter/inception/mercury-2` on pi transport with `thinkingLevel: medium`, plus judge `openai-codex/gpt-5.4` on pi transport with `thinkingLevel: medium`.

## Final notes and learnings
- The config surface is already independent enough for this run: candidate model(s) are configured under `models.candidates` and use the top-level `transport`, while the judge uses `judge.model` plus an optional `judge.transport` override.
- For the first real run, both sides now use pi sessions with medium thinking: candidate `openrouter/inception/mercury-2`, judge `openai-codex/gpt-5.4`.
- The verification smoke run is under `benchmark-results/swiftui-docs-chatbot-benchmark--smoke-verify-both-medium/` and confirms the intended transport and thinking settings end to end.
