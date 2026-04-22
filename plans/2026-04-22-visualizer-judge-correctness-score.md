# Visualizer Judge Correctness Score

## Goal
Clarify how the visualizer currently computes judge correctness, then add a judge correctness score that reflects summed judge correctness points over total questions so the overview better reflects the new scoring model.

## TODO
- [x] Confirm the current judge-correct metric path in the visualizer and identify where it only counts correctness `= 1` answers.
- [x] Add a derived judge correctness score to the visualizer types/helpers and surface it in the overview and metric desk.
- [x] Verify the visualizer build after the scoring display update.
- [ ] Commit the change in Daniel-style.

## Progress Notes
- [2026-04-22 02:55] Created the plan after confirming the visualizer currently foregrounds judge correct rate rather than a summed correctness score.
- [2026-04-22 03:02] Confirmed the current "Judge correct rate" metric is `judgeCorrectCount / judgeRuns`, which only counts answers scored `correctness = 1` and ignores the negative weight of `correctness = -1`.
- [2026-04-22 03:09] Added a derived judge correctness score in the visualizer as summed correctness points over total runs/questions, surfaced it in the overview, execution detail metrics, question-level badges, and metric desk, while keeping judge correct rate as a secondary percentage view.
- [2026-04-22 03:10] Rebuilt the visualizer successfully after the scoring update.

## Final notes and learnings
- Pending final commit pass.
