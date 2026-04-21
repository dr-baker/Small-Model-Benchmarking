# LLM Judge — Issues and Proposed Improvements

## Background

The judge is the **authoritative evaluator** for this benchmark.

The deterministic grader remains in the pipeline, but only as a:

- meta-comparison tool
- regression/debugging aid
- rubric-quality signal

That means the judge refactor should optimize for a cleaner, more stable, more interpretable scoring surface rather than for agreement with deterministic grading.

The refreshed benchmark metadata now uses:

- `evidenceBasis: "corpus" | "curated"`
- `questionShape: "targeted" | "synthesis"`
- `platformScope: "ios" | "macos" | "all"`

Any policy in this plan should use those names, not the older `questionType` / `best_practice` terms.

## Current issues

### J1. Retrieval handling still leaks into closed-book judgment

Closed-book runs should not be penalized for missing retrieval evidence. Today the prompt still gives the model room to dock answers on retrieval-related grounds even when the run mode never expected retrieval.

### J2. Forbidden-pattern handling is too binary

The current `recommendsDeprecatedPattern: boolean` cannot distinguish:

- primary recommendation of the old API
- fallback recommendation
- warning-only mention
- not mentioned at all

That makes the judge too lenient in some cases and too harsh in others.

### J3. The current scoring surface is too large for the job

The existing judge emits:

- `recommendsCorrectPattern`
- `recommendsDeprecatedPattern`
- `completeness` (0/1/2)
- `codeExample` (0/1/2)
- `explanation` (0/1/2)
- `retrievalSupportsReferenceAnswer`
- `retrievalQuality` (0/1/2)
- derived `verdict`

That is more surface area than we need for the benchmark’s actual decision-making.

### J4. Unverifiable curated references need explicit signaling

On some curated questions, the judge may not be able to verify the reference directly from the corpus. That should not silently look as strong as a clean corpus-grounded judgment.

### J5. Judge cost should scale by question shape

A flat judge tool budget is now the wrong abstraction. The benchmark contains both:

- short targeted questions
- broader synthesis questions

Those should not be forced through the same retrieval budget.

## Refactor direction

Move the judge to a smaller authoritative surface built around **two numeric axes**:

- `correctness: -1 | 0 | 1`
- `completeness: -1 | 0 | 1`

and a small set of supporting fields.

This keeps the judge expressive enough to capture mixed answers, but much smaller and more stable than the current multi-axis scheme.

## Implementation status

This plan is **partially implemented** in the working tree as of 2026-04-21.

Landed in the first slice:
- prompt/schema now ask for `correctness`, `completeness`, `deprecatedPatternUse`, `referenceVerified`, and `observations`
- `src/judge/run.ts` parses those fields and writes them into `judge.json`
- closed-book handling is now explicit in the judge prompt
- old retrieval-scored judge axes were removed from the response schema

Not landed yet:
- separate `judge.v2.json` artifact alongside legacy `judge.json`
- aggregate preference for v2 plus mean correctness/completeness reporting
- question-shape-aware tool budgets
- calibration/tests around the new scoring surface
- cleaner downstream migration away from legacy compatibility fields

## Proposed judge v2 surface

### Core fields

```jsonc
{
  "correctness": 1,
  "completeness": 1,
  "deprecatedPatternUse": "not_mentioned",
  "referenceVerified": true,
  "reasoning": "One short sentence.",
  "observations": {
    "hasCode": true,
    "hasExplanation": true,
    "mode": "open_book"
  }
}
```

### Required fields

- [x] `correctness: -1 | 0 | 1`
- [x] `completeness: -1 | 0 | 1`
- [x] `deprecatedPatternUse: "primary" | "fallback" | "warning_only" | "not_mentioned"`
- [x] `referenceVerified: boolean`
- [x] `reasoning: string`
- [x] `observations.hasCode: boolean`
- [x] `observations.hasExplanation: boolean`
- [x] `observations.mode: "closed_book" | "open_book"`

### Optional / computed downstream

- [x] A downstream convenience label may be derived from `correctness`, but the authoritative stored value is numeric.
- [ ] Retrieval metrics should come from traces, not from the judge.

## How to score correctness

### `correctness = 1`
Use when the candidate’s primary recommendation matches the reference answer’s modern pattern.

This means:

- the answer recommends the correct modern API / pattern
- any old API is mentioned only as a warning, migration source, or clearly non-preferred fallback
- there is no materially conflicting secondary recommendation that would send a developer down the wrong path

### `correctness = 0`
Use for mixed, hedged, or ambiguous answers.

Examples:

- names the right modern API but also recommends a wrong or deprecated fallback strongly enough that a reader could reasonably choose it
- mixes old and new approaches without clearly preferring the right one
- gets the general direction right but stays too ambiguous to count as a clean correct recommendation

This bucket is the replacement for a large share of the old `partially_correct` behavior.

### `correctness = -1`
Use when the answer is materially wrong.

Examples:

- recommends the wrong or deprecated pattern as the primary path
- contradicts the reference answer’s core recommendation
- omits the modern pattern entirely and steers the reader to the old one

## How to score completeness

Completeness is **not** “did the answer say everything in the docs.”
It answers a narrower question:

> If the correctness is acceptable, how actionable and sufficiently covered is the answer for this question type?

### `completeness = 1`
The answer is sufficiently actionable for the question.

#### For targeted questions
Score `1` when the answer includes:

- the correct modern pattern
- the essential implementation detail(s) needed to apply it
- the key caveat / constraint if one is central to the question
- code when the question is implementation-oriented enough that omitting code would make the answer materially less actionable

Examples:
- gives `NavigationStack` **and** `navigationDestination(for:)`
- gives `sheet(item:)` with the right presentation shape
- gives `Task { await ... }` for an async button tap and explains why

#### For synthesis questions
Score `1` when the answer:

- covers the main buckets the user asked for
- organizes the answer coherently
- includes the main tradeoffs / caveats
- prioritizes the important pieces rather than listing APIs without structure

Examples:
- Liquid Glass answer covers automatic system behavior, custom view APIs, grouping/morphing, and performance
- navigation architecture answer covers tabs, stacks/split views, value-based destinations, and deep-link/programmatic state

### `completeness = 0`
The answer is directionally useful but incomplete.

#### For targeted questions
Use `0` when the answer:

- names the right API but omits an important usage detail
- lacks the key caveat that would matter in practice
- is plausible but too terse to apply directly
- gives explanation without enough implementation detail, or code without enough framing

#### For synthesis questions
Use `0` when the answer:

- covers only some of the important buckets
- misses an important tradeoff or constraint
- reads like a partial notes dump rather than a usable synthesis

### `completeness = -1`
The answer is too incomplete to be operationally useful.

Use when the answer:

- is technically too thin to apply
- misses core parts of the asked problem
- leaves a materially misleading impression because of omitted constraints
- on synthesis questions, covers only fragments of the requested surface

Important: `completeness = -1` does **not** require `correctness = -1`. A technically right but unusably incomplete answer can score `correctness = 1`, `completeness = -1`.

## Supporting policies

### FJ1. Make retrieval mode-aware and stop asking the judge to score retrieval quality

- [x] Remove `retrievalQuality` and `retrievalSupportsReferenceAnswer` from the judge schema.
- [ ] Keep retrieval evaluation in deterministic trace-derived metrics instead.
- [x] Explicitly tell the judge not to penalize closed-book runs for missing retrieval.
- [ ] Preserve candidate answer groundedness and retrieval metrics in aggregate from existing trace logic.

Why: retrieval quality is already observable from traces. Re-asking the judge to score it creates noise, especially on closed-book runs.

### FJ2. Replace binary deprecated-pattern handling with a four-state field

- [x] Add `deprecatedPatternUse: "primary" | "fallback" | "warning_only" | "not_mentioned"`.
- [ ] Teach the prompt to distinguish a real recommendation from a warning-only mention.
- [ ] Let downstream analysis decide how much `fallback` should matter by rubric tier.

Why: the current boolean is too coarse.

### FJ3. Keep the judge authoritative, but emit `referenceVerified`

- [x] Add `referenceVerified: boolean`.
- [ ] For `evidenceBasis: "corpus"` questions, repeated `referenceVerified: false` should be treated as a dataset or judge-retrieval issue.
- [ ] For `evidenceBasis: "curated"` questions, `referenceVerified: false` should lower confidence in downstream reporting, but not automatically invalidate the judgment.

Why: authoritative does not mean pretending every judgment was corpus-verified.

### FJ4. Scale tool budgets by `questionShape`

- [ ] Add separate soft/hard budgets for `targeted` vs `synthesis` questions.
- [ ] Example starting point:
      - `targeted`: soft 4, hard 6
      - `synthesis`: soft 8, hard 10
- [ ] Prefer verifying cited paths or the most likely canonical page first before broader exploration.
- [ ] Log `judgeToolCallCount` and average by question shape.

Why: a flat budget will under-serve synthesis questions or over-serve targeted ones.

### FJ5. Write v2 beside v1 for one comparison sweep

- [x] Write the new output to `judge.v2.json`.
- [x] Keep `judge.json` / v1 readable during the migration.
- [x] Teach aggregate to prefer v2 when present and fall back to v1.
- [ ] Compare v1 and v2 on at least one full sweep before cutover.

## Aggregate / reporting changes

Once the judge uses the new numeric axes, aggregate output should report:

- [x] mean correctness
- [x] correctness distribution (`-1`, `0`, `1` rates)
- [x] mean completeness
- [x] completeness distribution (`-1`, `0`, `1` rates)
- [x] `referenceVerified` rate
- [x] deterministic/judge agreement as a comparison signal

The deterministic grader should remain visible, but not as the benchmark authority.

## Acceptance criteria

1. The authoritative judge surface is reduced to:
   - correctness
   - completeness
   - deprecated pattern use
   - reference verification
   - short observations
2. Closed-book runs are no longer penalized on retrieval-quality grounds.
3. The judge cleanly distinguishes warning-only mentions from fallback or primary recommendations of old APIs.
4. Aggregate output can report mean correctness and mean completeness directly.
5. A comparison sweep shows that v2 is easier to interpret than v1 without obvious regressions on a manually reviewed calibration set.

## Progress Notes
- 2026-04-21: Implemented the initial judge-v2 slice in the core judge path: new authoritative fields, explicit closed-book guidance, and schema/prompt updates. Retrieval-scored judge axes remain a downstream migration item.
- 2026-04-21: This is not fully migrated yet. The working tree still uses compatibility fields, and broader cleanup away from legacy/mirrored judge fields is still pending.
- 2026-04-21: Landed the migration slice: judge now writes `judge.v2.json` alongside compatible `judge.json`, and aggregate prefers v2 while surfacing mean/distribution reporting for correctness/completeness plus `referenceVerified` and deterministic-agreement fields.

## Non-goals

- Not making deterministic grading authoritative.
- Not forcing every answer into a binary correct/incorrect-only surface if `0` meaningfully captures mixed answers.
- Not using a flat judge tool budget across targeted and synthesis questions.
- Not removing the migration path for historical judge artifacts.

