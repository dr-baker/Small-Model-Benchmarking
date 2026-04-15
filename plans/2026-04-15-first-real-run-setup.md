# First Real Run Setup

## Goal
Configure the benchmark for the first real run using pi SDK for the judge and OpenRouter Mercury 2 for the test model, then run a small smoke test to verify both model paths are wired correctly.

## TODO
- [x] Review the current benchmark runner and pi SDK docs for model selection and thinking-level support.
- [x] Verify the requested judge and candidate model identifiers are available through pi/OpenRouter in this environment.
- [x] Update benchmark configuration/code so the judge uses pi SDK GPT 5.4 with medium thinking and the candidate uses OpenRouter inception/mercury-2.
- [x] Run a small benchmark smoke test and inspect artifacts for successful collect + judge execution.
- [x] Summarize the exact command/config for the first real run.

## Progress Notes
- 2026-04-15 00:00: Created plan file for first real-run setup and smoke-test verification.
- 2026-04-15 00:05: Read README plus recent plans covering centralized config, pi/openrouter transport support, and the new judge stage.
- 2026-04-15 00:10: Confirmed current runner supports transport overrides, but transport was shared across collect and judge, so mixed candidate/judge transports needed a small refactor.
- 2026-04-15 00:12: Confirmed pi SDK supports `thinkingLevel: "medium"` in `createAgentSession()`. Current benchmark code hardcoded pi thinking to `"off"`, so that needed to change for the requested judge setup.
- 2026-04-15 22:25: Verified pi can resolve `openai/gpt-5.4` and `openrouter/openai/gpt-5.4`, and OpenRouter can resolve `openrouter/inception/mercury-2`. Also confirmed this machine has an OpenRouter credential but no native OpenAI API key in pi auth, so the practical judge model choice here is pi SDK + `openrouter/openai/gpt-5.4`.
- 2026-04-15 22:33: Added optional `judge.transport` config support, added optional pi `thinkingLevel` config, and updated the runner so collect and judge can use different transports.
- 2026-04-15 22:35: Updated `benchmark.yaml` to use `openrouter/inception/mercury-2` for candidates and pi SDK `openrouter/openai/gpt-5.4` with `thinkingLevel: medium` for judging. Also updated README config docs.
- 2026-04-15 22:36: Verified with `npm run typecheck` and `npm run check:architecture`.
- 2026-04-15 22:37: Ran smoke test `npm run test:run -- --run-id=smoke-gpt54-mercury2 --question=q01-tab-definition --mode=open_book --batch-size=1 --batch-number=1 --resume=false`. Collect ran via OpenRouter Mercury 2 and judge ran via pi transport with `openrouter/openai/gpt-5.4` + `thinkingLevel: medium`; artifacts recorded both successfully.

## Final notes and learnings
- The runner now supports a clean mixed setup: candidate answers can use direct OpenRouter HTTP while the judge uses pi SDK sessions with an independent model/transport.
- Pi SDK thinking level is now configurable through transport session config instead of being hardcoded off.
- Because this environment has an OpenRouter credential but not a native OpenAI key, the configured judge uses GPT-5.4 through the pi SDK on the `openrouter` provider. If a native OpenAI key is added later, switching to `openai/gpt-5.4` only requires changing `judge.model`.
- Smoke test artifacts are under `benchmark-results/swiftui-docs-chatbot-benchmark--smoke-gpt54-mercury2/` and show the intended transport split working end to end.
