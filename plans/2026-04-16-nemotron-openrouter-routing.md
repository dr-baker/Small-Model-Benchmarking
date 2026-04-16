# Nemotron OpenRouter Routing Run

## Goal
Use the Nemotron Nitro model via direct OpenRouter transport, matching the OpenRouter provider-routing config from Daniel's pi config, and verify the benchmark can run with that wiring.

## TODO
- [x] Inspect Daniel's pi model config for Nemotron Nitro and identify the exact OpenRouter routing settings.
- [x] Add benchmark support for passing OpenRouter provider-routing config through direct OpenRouter transport.
- [x] Wire benchmark config for a Nemotron test run using `openrouter/nvidia/nemotron-3-super-120b-a12b:nitro`.
- [x] Verify with typecheck and run a small benchmark smoke batch.
- [x] Summarize the exact config and command to use for the next larger run.

## Progress Notes
- [2026-04-16 01:00] Started by inspecting `~/.pi/agent/models.json` and related pi settings for Nemotron Nitro.
- [2026-04-16 01:05] Confirmed pi model config uses `openRouterRouting.order = ["deepinfra/bf16"]` and `only = ["deepinfra/bf16"]` for `nvidia/nemotron-3-super-120b-a12b:nitro`.
- [2026-04-16 01:07] Added `transport.openRouterRouting` support to benchmark config + OpenRouter client request body so direct benchmark runs can match pi routing.
- [2026-04-16 01:09] First smoke run failed because DeepInfra does not support OpenRouter `json_schema` response format for this model/provider route.
- [2026-04-16 01:11] Added automatic OpenRouter fallback: when a provider rejects `json_schema` with 405, retry the same request without `response_format` and let the benchmark parser handle the structured output contract.
- [2026-04-16 01:15] Re-ran a 2-question smoke batch successfully under `swiftui-docs-chatbot-benchmark--nemotron3-super-openrouter-v1`.

## Final notes and learnings
- Matching pi's Nemotron Nitro setup required two pieces: using the `openrouter` provider/model id plus forwarding OpenRouter provider routing (`deepinfra/bf16`) in the HTTP request body.
- This route does not support OpenRouter JSON Schema structured outputs, so the benchmark now falls back automatically to prompt-only structured output for direct OpenRouter runs when needed.
