# Structured Outputs via OpenRouter API

**Status:** ✅ Implemented
**Date:** 2026-04-13

## Summary

Replace prompt-based JSON schema enforcement with API-level `response_format: { type: "json_schema" }` for both collect and judge stages. Bypass pi SDK's `createAgentSession` (no `response_format` support) with a lightweight direct-HTTP LLM client.

## Motivation

- Current approach: system prompt says "Follow the response schema exactly" → model often produces invalid JSON or schema-mismatched output → `schema_parse_failure`
- OpenRouter supports structured outputs natively for many models (OpenAI, Anthropic, Gemini, most open-source, Fireworks)
- API-enforced schema = guaranteed valid JSON, guaranteed schema conformance
- Eliminates `schema_parse_failure` failure mode entirely

## Changes

| File | Action | Description |
|------|--------|-------------|
| `src/shared/response-schemas.ts` | NEW | JSON Schema defs for answer/judge responses + `buildAnswerResponseFormat()` / `buildJudgeVerdictResponseFormat()` |
| `src/shared/llm-client.ts` | NEW | Lightweight LLM client with tool-call loop, structured output support, event/usage tracking |
| `src/collect/run.ts` | MODIFY | Replace `createAgentSession` with `runLlmClient` |
| `src/judge/run.ts` | MODIFY | Replace `createAgentSession` with `runLlmClient` |
| `src/collect/minimal-resource-loader.ts` | DELETE | No longer needed (was for pi SDK sessions) |

## Key Design Decisions

- Use `fetch` (no new deps) for OpenRouter API calls
- Reuse pi SDK `AgentTool.execute()` for tool execution (read/grep/find/ls)
- `response_format` passed on every API call in loop (model uses tools when needed, outputs JSON when done)
- `.env` file auto-loaded from project root (same as before)
- Backward compatible: contract versions, trace format, output files all unchanged

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Not all models support structured outputs | Fallback: skip `response_format` for unsupported models (future work) |
| `strict: true` may increase token usage slightly | Acceptable tradeoff for guaranteed validity |
| Tool-call + structured output interaction | Tested: model makes tool calls normally, outputs structured JSON on final turn |

## TODO

- [x] Create `src/shared/response-schemas.ts`
- [x] Create `src/shared/llm-client.ts`
- [x] Refactor `src/collect/run.ts`
- [x] Refactor `src/judge/run.ts`
- [x] Delete `src/collect/minimal-resource-loader.ts`
- [x] Typecheck passes
- [x] Architecture check passes
- [ ] End-to-end test run
- [ ] Add model capability check (skip `response_format` for unsupported models)
