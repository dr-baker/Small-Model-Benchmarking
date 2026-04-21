# Benchmark Refresh: Categories and Open-Ended Questions

## Goal
Refresh the Swift benchmark so questions sound more like real user asks, add minimal new categorizations, introduce several open-ended synthesis questions, and update dataset/rubric/grading/aggregation to support the new structure.

## TODO
- [x] Inspect the dataset, rubric, grading, aggregation, and visualizer surfaces that encode question metadata.
- [x] Design the minimal question categorizations for platform scope and question shape, then update shared contracts and pipeline code.
- [x] Rewrite the most answer-shaped benchmark questions and add new open-ended synthesis questions with supporting corpus evidence.
- [x] Update rubric and gold evidence for rewritten and new questions, including broader evidence bundles where needed.
- [x] Regenerate derived artifacts and update aggregation/visualizer outputs to carry the new metadata.
- [x] Run build, dataset validation, and architecture/type checks.

## Progress Notes
- [2026-04-21 00:35] Started implementation plan for benchmark refresh.
- [2026-04-21 00:46] Reworked the source bank: rewrote the most answer-shaped targeted prompts and added eight new synthesis questions covering Liquid Glass, navigation, search, layout, accessibility, document apps, interop, and macOS commands.
- [2026-04-21 00:57] Added explicit question metadata via `benchmark/dataset/question-metadata.v1.json` with minimal axes: `platformScope` (`ios`/`macos`/`all`) and `questionShape` (`targeted`/`synthesis`). Renamed the provenance axis from `questionType` to `evidenceBasis` and tightened the values to `corpus` vs `curated`.
- [2026-04-21 01:05] Extended deterministic grading with optional `mustMentionAnyOf` concept groups plus `passThreshold` so synthesis questions can earn deterministic credit without brittle exact-string requirements.
- [2026-04-21 01:14] Regenerated the dataset and question-bank outputs. Verified `npm run dataset:validate`, `npm run check:architecture`, `npm run build`, and the visualizer TypeScript build.

## Final notes and learnings
- The benchmark now has 83 questions and a clearer split between direct implementation asks and broader docs-synthesis asks.
- The minimal metadata model that held up best was three independent axes: evidence basis (`evidenceBasis`), platform scope, and question shape. Anything more detailed started to look like topical taxonomy rather than benchmark control metadata.
- Adding concept-group grading was enough to support broad synthesis questions without introducing an LLM dependency into deterministic grading.
