# Benchmark Visualizer

## Goal
Create contained frontend subrepo that lets Daniel upload several benchmark run results and inspect top-level scores, score breakdowns, and every question with all answers, reference/rubric info, and grades.

## TODO
- [x] Inspect benchmark assets and result artifacts needed for uploaded-run comparison and per-question drilldown.
- [x] Create contained frontend subrepo with its own package setup and modern visual design.
- [x] Implement client-side upload/parsing for multiple run results and comparison summaries.
- [x] Implement per-question collapsible views with answers, reference answer, rubric, deterministic grade, and judge details.
- [x] Build and verify subrepo production bundle.
- [x] Redesign layout for 9+ models with moveable/visibility-controlled model rows and less wide comparison patterns.
- [x] Add toggleable sidebar with section navigation, library controls, and model management.
- [x] Rework visual design into editorial/newspaper analysis style with HSL-based light/dark themes.
- [x] Rebuild and verify redesigned app.
- [x] Rethink question-review UX around core task: read question, compare model scores, inspect answers.
- [x] Replace long archive flow with focused question navigator + single-question comparison workspace.
- [x] Simplify density in answer review and hide secondary detail behind deliberate expansion.
- [x] Rebuild and verify focused UX revision.
- [x] Parse judge detail into structured visual blocks instead of raw bullet list.
- [ ] Rebuild and verify judge-detail refinement.
- [x] Refresh bundled recent runs so the new structured search-read campaign runs appear in the visualizer.
- [x] Update visualizer correctness-score views to count errored runs as -1 instead of 0.

## Progress Notes
- 2026-04-20 23:xx Plan created.
- 2026-04-20 23:xx Confirmed `aggregate.json` already contains per-run question, answer, grade, judge, cost, and artifact summary needed for comparison views. Confirmed benchmark metadata needed for reference/rubric lives in `benchmark/dataset/swiftui-docs-chatbot-benchmark.v1.json` and `benchmark/rubric/rubric.v1.json`.
- 2026-04-20 23:xx Created contained app at `tools/benchmark-visualizer/` with own `package.json`, Vite + React + TypeScript setup, and generated question-bank metadata derived from repo benchmark assets.
- 2026-04-20 23:xx Implemented local browser upload for multiple `aggregate.json` files or execution folders, top-level comparison cards, score breakdown table, question-type breakdowns, search/filter/sort controls, and per-question collapsible answer comparison cards.
- 2026-04-20 23:xx Added generated recent-run snapshot loader so app opens with nine latest local benchmark aggregates already loaded, plus restore button for that preset.
- 2026-04-20 23:xx Redesigned app for large model sets using sidebar-managed model ordering/visibility, ranked metric ledgers instead of one giant wide table, and collapsible per-model answer rows inside each question.
- 2026-04-20 23:xx Reworked visual system into editorial/news-analysis style and switched theme tokens to HSL-driven light/dark palettes without decorative AI-style gradients.
- 2026-04-20 23:xx Reframed question UX around single-question review: left question navigator, center comparison workspace, per-question score table, and selectively expandable answer rows with secondary detail hidden by default.
- 2026-04-20 23:xx Tightened question selector density, reduced corner radius, moved reference answer + rubric into always-visible top-level question dossier, and merged answer inspection into expandable score-table rows.
- 2026-04-20 23:xx Added clearer expansion indicators on expandable surfaces and did polish pass on spacing, nesting, and emphasis to reduce card overload.
- 2026-04-20 23:xx Refined judge detail presentation from raw bullet list into structured badges, parsed score chips, and separated reasoning block so judge dimensions read like first-class metrics.
- 2026-04-20 23:xx Verified production build with `cd tools/benchmark-visualizer && npm run build`.
- 2026-04-20 23:xx Started preview server at `http://127.0.0.1:4173/` and opened browser to it.
- 2026-04-23 06:xx Regenerated `public/generated/recent-runs.json` after the full structured search-read campaigns for Grok, Mercury, and GPT OSS Baseten completed so those executions are bundled into the visualizer again.
- 2026-04-23 06:xx Updated the visualizer's correctness-score calculations so benchmark errors count as -1 in both summary metrics and per-question comparison scores, matching the harsher end-to-end interpretation we wanted when comparing flaky runs.
- 2026-04-24 01:xx Rebuilt the visualizer after the 24-run additional-model all-toolsets sweep completed; `public/generated/recent-runs.json` now bundles 48 recent runs including the new Qwen, Devstral, GLM, and Gemma executions.

## Final notes and learnings
- Shipped standalone benchmark visualizer subrepo under `tools/benchmark-visualizer/`.
- App processes uploaded run results locally in browser and does not need backend changes.
- Bundling question metadata from dataset + rubric lets per-question views show reference answers and rubric rules even though uploaded result artifacts only carry grade/judge outputs.
- Recent local runs can be preloaded from repo snapshot so inspection starts immediately before any manual upload.
- For dense comparison sets, movable sidebar model rows plus collapsible per-question answer rows scale better than broad comparison grids.
- Single-question master-detail review is easier to read than long archives when core task is question → compare scores → inspect answer.
- Compact selector rows and expandable comparison-table rows communicate hierarchy better than stacking full cards for every object.
