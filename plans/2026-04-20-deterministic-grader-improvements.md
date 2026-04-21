# Deterministic Grader — Issues and Proposed Improvements

## Background

The deterministic grader in `src/grade/run.ts` is still cheap and useful, but it is **not** the authoritative evaluator. After the 2026-04-20 discrepancy analysis and subsequent spot checks, the project direction is:

- the **LLM judge is authoritative** for benchmark scoring
- the deterministic grader remains a **meta-comparison and debugging tool**
- deterministic grading should be improved enough that its disagreements with the judge are informative rather than noisy

That changes the goal of this refactor. We are **not** trying to make deterministic grading the primary source of truth. We are trying to:

1. remove the most obvious false positives and false negatives
2. make disagreement buckets easier to interpret
3. keep deterministic outputs useful for regressions, rubric debugging, and analysis

The refreshed benchmark metadata now uses:

- `evidenceBasis: "corpus" | "curated"`
- `questionShape: "targeted" | "synthesis"`
- `platformScope: "ios" | "macos" | "all"`

Any grading-policy logic in this plan should use those fields, not the older `questionType` / `best_practice` naming.

## Issues (root-cause summary)

1. **No polarity model.** `mustMention: ["optional"]` passes *"No, the `tags` relationship does **not** need to be optional"*.
2. **Keyword matches any overload / argument.** `mustMention: ["onChange"]` passes the deprecated single-arg variant; independent substrings also pass answers that assemble the wrong call shape.
3. **`isDeprecatedMentionContext` is too brittle.** The current 80-char window and marker list are weak both ways: they miss clear warning-only mentions, and they also forgive on over-broad markers.
4. **Weak handling of synthesis answers.** The grader can now use `mustMentionAnyOf`, but it still needs better policy for broad answers so the deterministic output stays interpretable.
5. **Some curated questions have weak or normative deterministic ground truth.** On those runs, deterministic grading should remain advisory and visibly low-confidence.
6. **Aggregate output still makes disagreement harder to read than it should.**

## Refactor goal

After this work, deterministic grading should produce one of three kinds of value:

- **strong corroboration** of the judge on clear targeted questions
- **useful disagreement signals** when a rubric is weak or a judgment is tricky
- **low-confidence advisory output** on curated / normative questions

It should not be treated as the final benchmark score.

## Implementation status

This plan is **partially implemented** in the working tree as of 2026-04-21.

Landed in the first slice:
- sentence-level `mustNotMention` warning handling in `src/grade/run.ts`
- sparse `expectedStance` support in rubric/contracts/grader
- `rubricStrength` emission in grade artifacts
- aggregate `agreement` output and `aggregate-disagreement.csv`

Landed in the second slice:
- targeted regex-style matcher support in the deterministic grader
- q20/q35 call-shape checks plus focused matcher tests
- additional `expectedStance` coverage on obvious high-signal yes/no targeted questions

Not landed yet:
- deterministic advisory policy for weak-rubric questions
- broader calibration/unit-test coverage for the new heuristics
- per-model disagreement summaries
- additional targeted call-shape upgrades beyond q20/q35

## Fixes

### F1. Replace warning-window matching with sentence-level recommendation detection

Target: `src/grade/run.ts`.

- [x] Replace the current raw-window warning heuristic with sentence-level classification around each forbidden phrase.
- [x] Classify each sentence containing the phrase as one of:
      - `warning_only`
      - `fallback`
      - `recommended`
      - `unclear`
- [x] Drop the broad `"not "` marker.
- [x] Add explicit sentence-initial and imperative warning markers such as:
      `No,`, `No.`, `Don't`, `Do not`, `Avoid`, `Never`, `Prefer`.
- [x] Only forgive `mustNotMention` when every matched sentence is clearly `warning_only`.
- [ ] Unit-test this using recorded answers from both disagreement directions.

Why: this is the best low-risk way to reduce noisy `mustNotMention` failures without over-forgiving real recommendations of the old pattern.

### F2. Add sparse per-question stance checks for yes/no prompts

Target: rubric schema + deterministic grader.

- [x] Add `expectedStance: "affirmative" | "negative" | "neutral"` to rubric entries.
- [x] Only use it on genuinely yes/no questions.
- [x] When `affirmative`, require the main modern recommendation to appear in a non-negated sentence.
- [x] When `negative`, require the discouraged pattern to appear in a clearly negated or warning-framed sentence.
- [x] Default all other questions to `neutral`.
- [x] Audit the obvious high-signal yes/no targeted questions and assign stance only where it adds real signal.

Why: this removes the biggest easy false-positive class without trying to force every question into a polarity model.

### F3. Promote brittle substring checks into targeted call-shape checks

Target: rubric schema + deterministic grader.

Keep this narrow and structural. Avoid giant answer-shaped regexes.

Initial candidates:

- [ ] q02 modern tab selection shape
- [ ] q08 chained `.fill(...).stroke(...)`
- [x] q20 modern `onChange` form
- [x] q35 `.scrollContentBackground(.visible)`
- [ ] q66 builder/content-storage form

Implementation notes:

- [x] Support either exact phrases or explicit regex-style matcher entries.
- [x] Require every upgraded pattern to have one passing and one failing focused test.
- [x] Prefer "call-site shape" checks over literal reference-answer shape.

### F4. Add deterministic grading policy for weak-rubric questions

This should **not** be keyed off all `curated` questions. Some curated questions remain perfectly deterministic-friendly.

Instead:

- [ ] Add `gradingPolicy: "both" | "deterministic_advisory"` to rubric entries or a grading-policy file.
- [ ] Mark obviously weak deterministic cases as `deterministic_advisory`.
- [ ] Start with q41 and any other question with empty or clearly normative rubric coverage.
- [ ] Keep deterministic artifacts for those runs, but surface them as low-confidence and exclude them from any "deterministic accuracy" headline.

Why: the deterministic grader should still emit useful metadata, but it should not pretend to have equal confidence everywhere.

### F5. Emit deterministic confidence / rubric strength

- [x] Emit `rubricStrength: "low" | "medium" | "high"` per run.
- [x] Base it on rubric shape, not answer outcome.
  - empty / almost-empty rule set → `low`
  - basic phrase rules → `medium`
  - stance + call-shape / regex checks → `high`
- [x] Include `rubricStrength` in aggregate run outputs.

Why: disagreement is much more useful when readers can see whether the deterministic rubric was strong or flimsy.

### F6. Make aggregate disagreement explicit

Target: `src/aggregate/run.ts` and aggregate CSV outputs.

- [x] Add `agreement` per run, comparing deterministic output to the authoritative judge.
- [x] Suggested values:
      - `agree_correct`
      - `agree_incorrect`
      - `det_only_positive`
      - `judge_only_positive`
      - `det_advisory`
- [x] Emit a sidecar disagreement CSV for fast review.
- [ ] Add per-model disagreement summaries in aggregate output.

Why: deterministic grading is now primarily a comparison tool, so disagreement needs to be a first-class output.

## Acceptance criteria

1. On a manually reviewed calibration set drawn from disagreement buckets, the deterministic grader no longer:
   - passes opposite-polarity answers that recommend the wrong thing
   - fails warning-only mentions of old APIs
2. The upgraded targeted checks (stance + call-shape) are unit-tested with real examples.
3. Aggregate output exposes deterministic/judge agreement explicitly.
4. Weak-rubric runs are visibly marked as advisory rather than silently mixed with stronger deterministic checks.
5. Deterministic grading remains fast and pure over saved traces.

## Non-goals

- Not replacing the judge as the benchmark authority.
- Not chasing perfect agreement with the judge.
- Not turning deterministic grading into a semantic scorer.
- Not changing benchmark questions or references in this plan.
