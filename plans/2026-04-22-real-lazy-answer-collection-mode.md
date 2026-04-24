# Real lazy answer collection mode

## Goal
Add a runtime-configurable answer collection mode that stops requiring JSON, extracts whatever answer metadata it can, leaves unavailable fields null, and persists the chosen mode through run metadata and artifacts.

## TODO
- [x] Add config and CLI support for selecting structured vs lazy answer collection.
- [x] Update collect prompting and normalization so lazy mode no longer requires JSON and can fall back to raw text.
- [x] Update judge, grade, and aggregate handling so missing answer metadata is tolerated when final answer text exists.
- [x] Persist answer collection mode in execution artifacts, manifest, and aggregate outputs.
- [x] Verify with typecheck and a focused lazy-mode smoke run.

## Progress Notes
- [2026-04-22 22:11] Created plan for the real lazy answer collection implementation after confirming the current setup still expects `answer-response.v1` JSON.
- [2026-04-22 22:24] Added `execution.answerCollectionMode` config support, a matching `--answer-collection-mode=` CLI override, manifest persistence, and aggregate CSV propagation.
- [2026-04-22 22:32] Reworked collect prompting so the benchmark prompt no longer hardcodes JSON. Structured runs still get a strict JSON contract appended at runtime; lazy runs now get plain-answer instructions and a mode-aware collect system prompt.
- [2026-04-22 22:39] Replaced strict collect parsing with normalization that keeps `finalAnswer` when raw prose exists, extracts structured fields when possible, and leaves unavailable metadata null. Judge now scores normalized answers whenever `finalAnswer` exists.
- [2026-04-22 22:44] Improved `extractJsonObject()` so fenced JSON and leading/trailing wrapper text are more recoverable.
- [2026-04-22 22:52] Verified with `npm run typecheck`, `npm run build`, and focused Gemini lazy-mode smokes on `q05-styling-text-with-a-custom-color` and `q10-shared-data-model-for-multiple-views`. Both runs reached judge coverage from plain-prose answers instead of failing collect.

## Final notes and learnings
- The earlier “lazy” setup only disabled provider-enforced structured outputs. The real fix was to remove JSON as a collection requirement in the prompt and normalizer.
- The new lazy mode still captures structured fields when models happen to return recoverable JSON, but correctness/completeness can now be judged from plain answer text.
- A remaining follow-up is to harden `src/shared/llm-client.ts` against malformed provider `choices` payloads and bad tool-call arguments, which still showed up in Trinity and some late-run Qwen failures.
