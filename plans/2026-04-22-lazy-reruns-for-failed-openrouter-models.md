# Lazy reruns for failed OpenRouter models

## Goal
Re-check the failed new-model open-book runs under the current non-structured collect path, confirm whether judge coverage improves, and relaunch full background runs for any model that clears the pilot gate.

## TODO
- [x] Confirm the current state of the in-flight new-model sweep and record the previously failed models.
- [x] Run fresh pilot batches for the failed models with the current non-structured collect configuration.
- [x] Audit pilot judge coverage and error rate for each failed model.
- [x] Launch full background reruns for the failed models under the real lazy answer-collection mode.
- [ ] Record final status, run ids, and follow-up notes.

## Progress Notes
- [2026-04-22 21:31] Created plan for failed-model lazy reruns and pilot-gated relaunch.
- [2026-04-22 21:46] Re-checked live sweep state. `grok-4.1-fast` remained healthy in flight. Failed models under review were `gemini-2.5-flash-lite`, `trinity-mini`, and `qwen3-next-80b-a3b-thinking`.
- [2026-04-22 21:58] Ran fresh 10-question pilot batches for the three failed models. Pilot outcomes: Gemini 2/10 judge coverage, Trinity 7/10 judge coverage with 3 collect errors, Qwen 10/10 judge coverage on the pilot batch.
- [2026-04-22 22:03] Log review showed the current "lazy" setup is still not true freeform collection: the prompt still demands a JSON object and collect still parses `answer-response.v1`. Gemini mostly fails by emitting plain prose, fenced JSON, or JSON with trailing text. Trinity and the late-run Qwen failures also show malformed tool-call / response-shape handling, including empty tool args and `src/shared/llm-client.ts` crashing on `data.choices[0]` when the provider response shape is incomplete.
- [2026-04-22 22:15] After implementing the real `lazy_text` answer-collection mode, launched fresh full background reruns:
  - `gemini-2-5-flash-lite-open-lazy-full-2026-04-22` — PID `98839` — log `/tmp/lazy-reruns/logs/gemini-2-5-flash-lite-open-lazy-full-2026-04-22.log`
  - `trinity-mini-open-lazy-full-2026-04-22` — PID `99834` — log `/tmp/lazy-reruns/logs/trinity-mini-open-lazy-full-2026-04-22.log`
  - `qwen3-next-80b-a3b-thinking-open-lazy-full-2026-04-22` — PID `99836` — log `/tmp/lazy-reruns/logs/qwen3-next-80b-a3b-thinking-open-lazy-full-2026-04-22.log`
- [2026-04-22 22:16] Confirmed `grok-4.1-fast-open-2026-04-22` completed at `83/83/0`. `grok-4-fast-open-2026-04-22` also completed at `83/82/1` but was not a zero-error completion. Regenerated `tools/benchmark-visualizer/public/generated/recent-runs.json` and rebuilt the visualizer so the latest complete runs are reflected on the recent-runs page.

## Final notes and learnings
- Pending.
