# Spoonfed RAG Tool

## Goal
Make the question-only spoonfed RAG flow a first-class benchmark collection mode/toolset and run a smoke comparison across Gemma, Grok, Mercury, GPT-OSS 120B Baseten, and GPT-OSS Safeguard 20B.

## TODO
- [ ] Inspect collection/toolset architecture for the cleanest integration point.
- [x] Inspect collection/toolset architecture for the cleanest integration point.
- [x] Implement first-class spoonfed RAG collection support without exposing benchmark metadata.
- [x] Add configuration/toolset entry for the new flow.
- [x] Run build/typecheck.
- [x] Run smoke benchmark across requested models, including Liquid LFM.
- [x] Summarize results and artifacts.
- [x] Add Spoonfed RAG label/icon to visualizer profile and recent-run generator.
- [x] Create and launch full matrix for requested models.

## Progress Notes
- 2026-04-25: Starting from working prototype in `scripts/test-spoonfeed-rag.ts`; need to integrate into benchmark pipeline.
- 2026-04-25: Integration point chosen: special collect branch for a new `spoonfed_rag` toolset, because it is orchestration rather than actual model-visible tools.
- 2026-04-25: Added `spoonfed_rag` toolset and collection branch. Build passes.
- 2026-04-25: Ran 5-question smoke across Gemma, Grok, Mercury, GPT-OSS 120B Baseten, GPT-OSS Safeguard 20B, and Liquid LFM.
- 2026-04-25: Added visualizer label/icon (`Spoonfed RAG`, 🥄) in runtime display profile and generated recent-runs metadata. Visualizer build currently fails on pre-existing `WithinModelSlopeCharts`/`WithinModelScatter` TS errors unrelated to this change.
- 2026-04-25: Full matrix launched in background with `scripts/matrices/spoonfed-rag-full-models.json`; main log `.tmp/spoonfed-rag-full-matrix.log`, per-entry logs under `.tmp/benchmark-matrix-logs/`.

## Final notes and learnings
- First-class `spoonfed_rag` works mechanically, but smoke results are mixed. It solves tool-calling but not retrieval/synthesis quality. q16 and q58 remain difficult; q63 improves for several models when accessibility wording is emphasized.
