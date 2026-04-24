# Review Judge and Deterministic Refactor Plans

## Goal
Review the 2026-04-20 grading discrepancy plans, validate the proposed findings and refactor direction, and recommend any adjustments before implementation starts.

## TODO
- [x] Read the new 2026-04-20 plans related to deterministic grading and judge behavior.
- [x] Cross-check the plans against the current benchmark code and recently updated dataset metadata.
- [x] Validate which findings and assumptions look solid versus risky or incomplete.
- [x] Summarize recommended tweaks to the refactor plan before implementation.

## Progress Notes
- [2026-04-21 01:35] Started review of the 2026-04-20 grading discrepancy plans after committing the benchmark refresh.
- [2026-04-21 01:44] Confirmed the core diagnosis in code: deterministic grading is still mainly substring matching plus a brittle warning-context heuristic, while the judge still carries an oversized scoring surface and some closed-book retrieval leakage.
- [2026-04-21 01:53] Validated the broad plan direction, but found several stale assumptions after the benchmark refresh: pipeline metadata now uses `evidenceBasis` instead of `questionType`, and the new `questionShape` axis should influence future grading policy and judge tool budgets.
- [2026-04-21 02:02] Recommended a tighter rollout: fix deterministic sentence-level warning handling, stance, and a few call-site patterns first; simplify and harden the judge next; then decide whether to fully collapse to a binary judge v2.

## Final notes and learnings
- The deterministic grader still needs surgical fixes, but it should remain a secondary guardrail rather than the source of truth.
- The judge plans are directionally right, but one assumption is stale: the current judge verdict is already derived mechanically in `src/judge/run.ts`, so the value of a judge v2 is simplification and binary scoring, not fixing verdict/axis drift.
- The biggest implementation tweak is to avoid keying refactors off stale `questionType` naming and to use `evidenceBasis` plus `questionShape` explicitly.
- A hard 4-tool-call judge budget is likely too strict for the new synthesis questions; budgets should scale by question shape.
