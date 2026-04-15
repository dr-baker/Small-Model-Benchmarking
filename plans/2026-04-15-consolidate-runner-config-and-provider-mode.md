# Consolidate Runner Config and Provider Mode

## Goal
Move remaining benchmark execution config into `benchmark.yaml`, make model transport configurable as either direct OpenRouter HTTP or pi SDK sessions, verify both paths work, and add a lightweight test command.

## TODO
- [x] Audit current config split across `benchmark.yaml`, judge profiles, and transport code; decide what should move into main config.
- [x] Refactor config/contracts so benchmark config owns judge settings and provider/transport configuration.
- [x] Implement a configurable model runner that supports both direct OpenRouter HTTP and pi SDK session execution.
- [x] Update collect/judge entry points and CLI wiring to use the new config shape.
- [x] Add a lightweight test that exercises both execution modes without a real network call.
- [x] Run typecheck and the lightweight test.

## Progress Notes
- 2026-04-15 00:00: Created plan file for config consolidation + transport configurability work.
- 2026-04-15 00:15: Reviewed the split config. `benchmark.yaml` already held most runtime settings, but judge execution still depended on `judges/judge-profiles.v1.json`, and transport behavior lived in code.
- 2026-04-15 00:36: Inlined judge profile config into `benchmark.yaml`, removed the runtime dependency on `judges/judge-profiles.v1.json`, and added top-level `transport.kind` (`openrouter` or `pi`).
- 2026-04-15 00:52: Added dual transport support in `src/shared/llm-client.ts`: direct OpenRouter HTTP keeps structured outputs, while pi SDK mode uses `createAgentSession()` with in-memory sessions and minimal resource loading.
- 2026-04-15 01:02: Updated collect/judge/aggregate/CLI wiring and added `scripts/test-transport-lite.ts` plus `npm run test:transport-lite` to verify both paths with no real network calls.
- 2026-04-15 01:04: Verified with `npm run typecheck`, `npm run check:architecture`, and `npm run test:transport-lite`.

## Final notes and learnings
- The main reason config felt split was that versioned judge behavior had been modeled as a separate catalog, while runtime execution choices were in `benchmark.yaml`. That separation was reasonable historically, but it made simple benchmark reconfiguration harder than it needed to be.
- The new shape keeps benchmark runtime control in one file while preserving explicit versioning on the inline judge profile.
- OpenRouter direct mode remains the strict structured-output path; pi mode trades that for session parity and uses prompt-level schema enforcement.
- A small injected-dependency transport test was enough to verify both code paths without introducing a full test framework.
