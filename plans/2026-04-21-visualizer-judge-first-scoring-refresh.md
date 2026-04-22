# Visualizer Judge-First Scoring Refresh

## Goal
Update the benchmark presentation site so it reflects the new judge-first scoring model, the new correctness/completeness parsing, and the deterministic grader’s reduced role as a comparison tool.

## TODO
- [x] Audit the visualizer data pipeline for stale fields like `questionType`, legacy judge metric assumptions, and old disagreement logic.
- [x] Update generated question-bank and aggregate typings to use `evidenceBasis`, judge correctness/completeness, `referenceVerified`, and deterministic agreement/rubric-strength fields.
- [x] Refactor the visualizer overview and question-detail UI to explain and foreground judge-first scoring while demoting legacy judge axes and deterministic-only signals.
- [x] Regenerate bundled visualizer data and verify the visualizer builds cleanly.
- [x] Summarize what changed in the plan notes, including any intentionally retained legacy compatibility views.

## Progress Notes
- [2026-04-21 21:00] Created plan after launching a refreshed full benchmark sweep in background lanes so the site can be updated against the new scoring rationale while the long-running jobs execute.
- [2026-04-21 21:35] Narrowed scope to the data-plumbing slice: normalized `evidenceBasis` in question-bank generation, normalized aggregate parsing for new judge fields and legacy fallbacks, and refreshed bundled recent runs.
- [2026-04-21 21:35] Completed the remaining UI slice in `App.tsx` and `styles.css`: overview and question review now foreground judge correctness/completeness and reference verification, while answer score and deterministic grade are shown as comparison/debug context.
- [2026-04-21 21:35] Verified `npm run build` inside `tools/benchmark-visualizer` after regenerating bundled data and the updated UI.
- [2026-04-21 21:42] Fixed review blockers by normalizing legacy verdict/completeness judge data into the new centered judge-first scale, correcting question-level `referenceVerified` denominator handling, and removing deterministic-score-based row highlighting from the primary judge-first comparison table.

## Final notes and learnings
- Landed the compatibility layer for older aggregate files while wiring the visualizer to the judge-first data model.
- Completed the overview and question-detail UI pass so authoritative judge signals now lead the experience, with deterministic scoring retained as secondary comparison/debug information.
- Legacy aggregate compatibility now covers stale `questionType` naming plus verdict-only / old-completeness judge payloads well enough for the updated judge-first UI to compare older and newer bundles without silently mixing scales.
