# LLM Judge Stage

## Goal
Add a semantic LLM-judge stage to the benchmark pipeline while keeping grade and aggregate as pure file-based stages.

## TODO
- [x] Extend the shared pipeline contracts for judge artifacts and judge profiles.
- [x] Add versioned judge config and prompt files for semantic answer evaluation.
- [x] Refactor `src/judge/run.ts` so the judge uses only the candidate answer plus frozen-corpus access, without `referenceAnswer`, `pitfall`, or rubric-derived inputs.
- [x] Restore a hard split where `src/grade/run.ts` is deterministic-only and does not consume `judge.json`.
- [x] Update the local runner / scripts to execute collect → judge → grade → aggregate with the split preserved, then re-verify the TypeScript build.

## Progress Notes
- 2026-04-13 00:00Z: Started implementation plan for adding a new judge stage. User explicitly said the calibration step is not needed, so rollout support will skip calibration artifacts/workflows for now.
- 2026-04-13 14:08Z: Added shared judge contracts in `src/shared/contracts.ts`, including versioned judge response/profile types, hybrid grading metadata, and a `judge` artifact slot in run manifests.
- 2026-04-13 14:12Z: Added `prompts/judge-answer-v1.md` and `judges/judge-profiles.v1.json` so judge behavior is versioned independently from the dataset and rubric.
- 2026-04-13 14:18Z: Implemented `src/judge/run.ts` as a new model-calling stage that reads `normalized-answer.json` and writes `judge.json` with scored / skipped / error states.
- 2026-04-13 14:25Z: Initially wired `src/grade/run.ts` to consume `judge.json`, then changed course after clarifying the architecture should keep deterministic grading and LLM judging as a hard split.
- 2026-04-13 14:29Z: Updated `scripts/test-run.ts` and `package.json` so the local harness now executes collect → judge → grade → aggregate and exposes `npm run test:run`.
- 2026-04-13 14:35Z: Refactored the judge stage to use only the benchmark question, candidate answer, and frozen-corpus tools (`read_grep_glob`) while explicitly excluding `referenceAnswer`, `pitfall`, and rubric-derived grading inputs from the prompt.
- 2026-04-13 14:37Z: Restored `src/grade/run.ts` to deterministic-only behavior so it ignores `judge.json` completely and remains a pure keyword / groundedness grader.
- 2026-04-13 14:39Z: Verified the split with `npm run typecheck`, `npm run build`, and `npm run check:architecture`.
- 2026-04-13 14:47Z: Simplified the judge output to a flat `judge-verdict.v1` shape with boolean pattern checks plus qualitative `completeness`, `codeExample`, and `explanation` scores. `schemaVersion`, `questionId`, and rolled-up `verdict` are now written by the harness rather than trusted from the model.

## Final notes and learnings
- Shipped a new `judge` stage without relaxing the existing architecture rule: only collect/judge call models, while grade/aggregate remain file-based.
- Deterministic grading and LLM judging are now a hard split: `grade.json` is deterministic-only, while `judge.json` is an independent corpus-assisted semantic evaluation artifact.
- The judge now works from the benchmark question, the candidate answer, and frozen-corpus tools only. It does not receive `referenceAnswer`, `pitfall`, or rubric phrases.
- The judge output is intentionally simple: flat booleans for pattern recommendation plus 0-2 qualitative scores for completeness, code quality, and explanation quality, with the harness computing the rolled-up verdict.
- Open-book support stays cleanly separated: deterministic groundedness/retrieval remain in the grader, while the judge can independently inspect the corpus during semantic evaluation.
- Calibration workflow was intentionally omitted per user direction.
