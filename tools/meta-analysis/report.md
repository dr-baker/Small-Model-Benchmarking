# Meta-analysis: deterministic grading vs. LLM-judge grading

Scope: the nine non-smoke execution dirs under `benchmark-results/` dated 2026-04-20
(three models × three modes: gpt-oss-120b, mercury-2, nemotron-3-super-120b;
closed-book, open-book, db / swift-docs-hybrid). 675 runs total, 589 of which have
a `judge.status == "scored"` verdict to compare against.

Artifacts produced for this write-up (next to this file):
- `combine-disagreements.py` — reproducible join of `grade.json` + `judge.json`
- `disagreements.json` — 324 disagreeing runs with full context
- `per-question-disagreements.csv` — per-question counts broken out by kind

---

## 1. How each grader works (and what that implies)

**Deterministic grader** (`src/grade/run.ts`): for each question the rubric lists
`mustMention` and `mustNotMention` substrings. The final answer is lowercased
and `String.includes(phrase.toLowerCase())` decides each bullet. A run is
"correct" only if every `mustMention` phrase appears **and** no `mustNotMention`
phrase appears. There is one semantic softener: a 160-char window around each
`mustNotMention` hit (`.{0,80}phrase.{0,80}`) is forgiven iff **every** window
contains at least one of a fixed list of warning markers (`deprecated`,
`legacy`, `avoid`, `don't use`, `instead of`, `rather than`, `replace`, the
word `not `, etc.).

Implications that fall out of this design:
1. **The grader has no model of polarity.** "Yes, you must use X" and "No, you
   don't need X" both pass `mustMention: [X]`.
2. **The grader has no model of which API is recommended.** A rubric like
   `mustMention: ["onChange"]` is satisfied by any mention of `onChange`, even
   one that pushes the deprecated `(newValue) -> Void` closure.
3. **The warning heuristic is too coarse both ways.** `"not "` is permissive
   enough to forgive any nearby "this is not the usual pattern"; while a plain
   `"No."` sentence-starter (common when the question is phrased as yes/no)
   does not match because the list only has `"not "` (trailing space) and
   `"no"` would collide with words like `know`, `notification`, `no-op`.
4. **`every(...)` over multiple hits is harsh.** Mentioning a forbidden API
   once with a warning and once neutrally flips the entire run to incorrect.

**LLM judge** (`src/judge/*`): receives the question, reference answer,
candidate answer, and the candidate's retrieval trace, then emits a six-field
rubric (`recommendsCorrectPattern`, `recommendsDeprecatedPattern`,
`completeness`, `codeExample`, `explanation`, `retrievalQuality`) with
free-form `reasoning`. It also has read/grep/find/ls tools over the frozen
corpus to verify claims. The verdict (`correct` / `partially_correct` /
`incorrect`) is derived holistically by the judge, not by summing the numeric
fields.

---

## 2. Headline numbers

589 runs with both a deterministic grade and a scored judge verdict.

| Relationship | Runs | Share |
| --- | --- | --- |
| Both systems agree: correct | 44 | 7.5% |
| Both systems agree: wrong | 221 | 37.5% |
| Disagreement (any kind, counting partial as its own bucket) | 324 | 55.0% |

Coarser framings of the same data:

- If the judge's `partially_correct` is folded into **wrong**, the two graders
  still disagree on 247 / 589 runs (42%).
- If `partially_correct` is folded into **correct**, they disagree on 167 /
  589 runs (28%).
- Either way, disagreement is not a fringe event — it's the most common single
  outcome, driven almost entirely by cases where the deterministic grader is
  too permissive.

Breakdown of the 324 disagreeing runs:

| Kind | n | Dominant failure mode |
| --- | --- | --- |
| `det_correct__judge_partial` | 157 | det-grader passes a keyword that only partially matches the reference's recommendation |
| `det_correct__judge_incorrect` | 73 | det-grader passes a keyword in a sentence that recommends the opposite thing |
| `det_wrong__judge_partial` | 77 | `mustNotMention` flags a brief/contrastive mention of the old API |
| `det_wrong__judge_correct` | 17 | same as above, but the judge thought the secondary mention was harmless |

Per-model split (rows sum across all modes):

| Model | Both-correct | Both-wrong | det_c_j_i | det_c_j_p | det_w_j_c | det_w_j_p | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| openai/gpt-oss-120b:nitro | 24 | 69 | 26 | 46 | 10 | 25 | 200 |
| inception/mercury-2 | 17 | 79 | 30 | 58 | 5 | 34 | 223 |
| nvidia/nemotron-3-super-120b-a12b | 3 | 73 | 17 | 53 | 2 | 18 | 166 |

Nemotron has the fewest `det_wrong__judge_correct` cases (only 2) mainly
because it rarely trips the mustNotMention heuristic — its answers are more
reticent. gpt-oss has the most, consistent with its habit of listing
alternatives.

---

## 3. Disagreement kind #1 — `det_correct__judge_incorrect` (73 runs)

This is the most interesting bucket: the deterministic grader confidently
passed the answer, and the judge said it is actually wrong. I spot-checked
the top-seven questions against the reference answer **and** the frozen
corpus. In every examined case, the judge was right and the deterministic
pass was a false positive.

### 3a. Negation bypass: the keyword is in a sentence that says the opposite

The substring check has no polarity awareness, so an answer can be graded
correct for containing the exact keyword the rubric demands while advising
the opposite action.

- **q58 — SwiftData relationships for CloudKit** (`mustMention: ["optional"]`).
  Six of the eight candidates wrote some variant of *"No, the `tags`
  relationship does **not** have to be optional for CloudKit"*. The word
  `optional` appears; the grader passes. Judge flags it as contradicting the
  reference.
- **q11 — `@Observable` + `@MainActor`** (`mustMention: ["@Observable",
  "@MainActor"]`). Seven candidates explicitly wrote *"No — `@Observable`
  does **not** need to be annotated with `@MainActor`"* while mentioning both
  tokens. Grader passes because the substrings appear.
- **q09 — smooth rounded corners** (`mustMention: ["RoundedRectangle",
  ".continuous"]`). Three candidates wrote *"you **need** to specify
  `.continuous` explicitly"* — the opposite of the reference's *"`.continuous`
  is already the default"*. Corpus confirms the reference:
  `RoundedRectangle.init(cornerRadius:style:)` defaults `style` to
  `.continuous`.
- **q57 — SwiftData `@Attribute(.unique)` with CloudKit**
  (`mustMention: ["CloudKit"]`). Candidates wrote *"Yes, use
  `@Attribute(.unique)`"* and only discussed CloudKit as an aside, directly
  contradicting the reference's "never use it when syncing through CloudKit".
- **q16 — empty search state** (`mustMention: ["ContentUnavailableView"]`).
  Candidates used the manual `ContentUnavailableView.search(text:)` overload
  rather than the reference's `ContentUnavailableView.search` which reads the
  query from the `searchable()` context automatically.

Verdict: 17 unique (question, keyword, model) tuples across 29 individual runs
exhibit a clear negation-or-opposite-recommendation pattern. The judge's
verdict is supported by the reference and, where corpus coverage exists, by
the corpus.

### 3b. API-overload bypass: the keyword passes but the recommended API is wrong

The rubric often demands a generic API family, not a specific overload. The
grader can't tell the modern overload from the deprecated one.

- **q20 — reacting to state changes** (`mustMention: ["onChange"]`).
  Eight candidates recommended `.onChange(of:perform:)` with the
  single-parameter `(newValue) -> Void` closure. The corpus page
  `pages/documentation/swiftui/scene/onchange(of:perform:).md` is marked
  `deprecatedAt: "17.0"` with message *"Use `onChange` with a two or zero
  parameter action closure instead."* The reference asks for the two- or
  zero-parameter form. All eight passed the deterministic check because
  "onChange" appears.
- **q35 — opaque ScrollView optimization**
  (`mustMention: ["scrollContentBackground"]`). Six candidates recommended
  `.scrollContentBackground(.hidden)` — the opposite argument from the
  reference's `.visible`. The corpus page
  `pages/documentation/swiftui/view/scrollcontentbackground(_:).md`
  confirms the reference: on macOS 15+ "`ScrollView` can become seamless by
  making the background visible."
- **q08 — stroke border on a filled shape**
  (`mustMention: [".fill(", ".stroke("]`). Seven candidates either kept the
  old `.fill { … }.overlay(RoundedRectangle().stroke())` pattern or switched
  to `.strokeBorder`. The reference and the corpus `ShapeView` page show the
  iOS 17+ direct chain `.fill(.blue).stroke(.white, lineWidth: 2)`. Both
  `.fill(` and `.stroke(` substrings still appear anywhere in the candidate
  answer, so the grader passes.
- **q66 — accepting child content** (`mustMention: ["@ViewBuilder",
  "Content"]`). Every disagreeing candidate wrote
  `@ViewBuilder let content: () -> Content` — an escaping view-building
  closure — instead of the reference's `@ViewBuilder let content: Content`
  where the builder's result is stored directly. Both tokens appear in
  either form.

### 3c. Questions that are largely unsupported by the frozen corpus

Two of the bucket's top questions (q11, q58) carry `questionType:
best_practice` with no gold evidence. Their reference answers are opinionated
claims — "`@Observable` classes must be `@MainActor`" and "all CloudKit-synced
SwiftData relationships must be optional". The corpus I searched contains
**zero** occurrences of `CloudKit`, and the best-practice prose tying
`@Observable` to `@MainActor` is not in `managing-model-data-in-your-app.md`.
The judge still tended to side with the reference, but on these questions
neither grader has documentary authority. They really are a test of whether
the model parrots the benchmark's house style, not whether the corpus
supports it.

---

## 4. Disagreement kind #2 — `det_wrong__judge_correct` (17 runs)

The mirror image: the deterministic check failed, usually because a single
`mustNotMention` substring appeared somewhere, but the judge still thought the
answer was substantively correct. Every top case I read fits the same
pattern: the candidate correctly recommends the modern API but also references
the deprecated API by name.

- **q39 — heterogeneous view returns** (`mustNotMention: ["AnyView"]`, 4
  runs). Candidates correctly recommend `@ViewBuilder` + `some View`, but
  mention `AnyView` "as a last-resort fallback" in a separate paragraph.
- **q43 — haptic feedback** (`mustNotMention: ["UIImpactFeedbackGenerator"]`).
  Candidate correctly leads with `sensoryFeedback(.success, trigger:)` but
  contrasts it with the UIKit feedback generator.
- **q62 — previews** (`mustNotMention: ["PreviewProvider"]`). Candidate
  correctly uses `#Preview { ... }` but mentions `PreviewProvider` as legacy
  in the same breath.
- **q45 — async delay** (`mustNotMention: ["nanoseconds"]`). Candidate shows
  `Task.sleep(for: .seconds(2))` and correctly notes that the older
  `Task.sleep(nanoseconds:)` overload is now secondary — violating the
  substring rule.

The warning-context heuristic is supposed to catch these; it misses because:
- The mention of the forbidden API is outside the 80-char window of any
  warning marker (the answer spends more than 80 chars describing the modern
  pattern before naming the old one).
- The forbidden phrase appears multiple times — once with "legacy" nearby,
  once in a neutral sentence like "these are equivalent to
  `UIImpactFeedbackGenerator.impactOccurred`" — and `every(...)` fails on the
  neutral one.

The judge is essentially right on all 17 of these. They are noisy false
negatives, not a real disagreement.

---

## 5. Disagreement kind #3 — `det_correct__judge_partial` (157 runs)

The deterministic grader gives a binary pass; the judge gives a 2/1/0 score
per axis and downgrades to `partially_correct`. These are the least-severe
disagreements but also the most numerous — and they tell us what the keyword
check **systematically fails to see**:

- **Missing concrete code.** q52 (Keychain), q54 (reduce-motion fade), q68
  (.alert), q32 (confirmationDialog). Candidate mentions the right API but
  gives no usable example. Judge docks `codeExample`.
- **Missing the "why".** q38 (ternary vs. if/else for view modifiers): the
  answer recommends the ternary but doesn't explain that if/else introduces
  `_ConditionalContent` and breaks structural identity. Judge docks
  `explanation`.
- **Keyword-only but no API verb.** q21 (`.animation(` + `value:`): the
  phrases appear anywhere in the text regardless of whether they are written
  as a call pattern. Candidates who mention `value:` only in a parenthetical
  aside still pass.
- **Dilution.** q50 (Identifiable): the reference wants a single
  recommendation; candidate gives a ranked list that mentions the correct
  answer among four alternatives.

In essentially every case I read, the judge's partial verdict is a more
honest description of the answer than a deterministic pass. The
deterministic grader has no notion of completeness — once the keyword is in,
it's in.

---

## 6. Disagreement kind #4 — `det_wrong__judge_partial` (77 runs)

Nearly identical root cause to kind #2. The deterministic grader fails the
answer because of a `mustNotMention` trip, but the judge thinks the answer is
directionally right with caveats. Top questions:

- q72 — `accessibilityHidden(true)` (5). The question **itself** contains
  `accessibilityHidden(true)`, and candidates start their answer with
  *"No, `accessibilityHidden(true)` should only be used on decorative
  elements"*. The grader's warning-markers list contains `"not "`
  (trailing space) but not `"No,"` or `"no, "`, so the warning context check
  doesn't activate. The phrase is correctly being warned against, but
  flagged as a violation.
- q73 — `NavigationView` (4), q46 — `DispatchQueue` (4), q44 —
  `DispatchQueue.main` (4), q23 — `animatableData` (3), q18 —
  `DateFormatter` (3). Same shape: candidate correctly recommends the modern
  API, names the old one as "the thing to migrate away from", warning marker
  is outside the 80-char window or one occurrence is neutral.

These are also mostly false negatives. The judge's partial verdict is often
driven by secondary issues (missing code, weak retrieval citations) rather
than by the forbidden-keyword mention itself.

---

## 7. Where the judge is itself imperfect

Not every disagreement is a deterministic-grader miss. A few pathological
cases from the judge are worth noting:

- **Judge is picky about retrieval even for closed-book runs.** In the
  `det_correct__judge_partial` bucket, ~30% of the judge's `reasoning` strings
  end with *"no retrieval evidence was provided"* despite the run being in
  `mode: closed_book`, where no retrieval is expected. This drags the
  `retrievalQuality` axis down and tips the verdict from `correct` to
  `partially_correct` without any content issue.
- **Judge sometimes accepts secondary-mention violations it ought to flag.**
  q39 runs in `det_wrong__judge_correct`: the candidate recommends
  `AnyView` as a "fallback" despite the reference explicitly forbidding it.
  The judge waved it through because the primary recommendation is
  `@ViewBuilder`. Whether this is a judge miss or an intended leniency is a
  design question for the rubric.
- **Judge's ground-truth is the reference answer, not the corpus.** On
  `best_practice` questions whose reference is not in the corpus (q11, q52,
  q58), the judge cannot independently verify; it trusts the reference. In a
  few of these cases the reference answer itself is an opinionated claim
  ("must be `@MainActor`") where reasonable alternative answers exist.

---

## 8. Taxonomy of root causes (summary)

| Root cause | Affected kind | Illustrative questions | Fix |
| --- | --- | --- | --- |
| Substring check has no polarity | det_c_j_i | q11, q58, q09, q57, q16 | add a negation-context check symmetric to the warning-context check, or encode required vs. forbidden stance per question |
| Rubric keyword matches multiple overloads | det_c_j_i | q20, q35, q08, q66 | make keywords be call-site regexes (e.g. `onChange\(of:[^)]*\)\s*\{\s*\w+,\s*\w+\s*in`), or list both the must-mention API and a must-mention argument |
| `isDeprecatedMentionContext` too tight (80-char window, `every(...)`, no "No,") | det_w_j_c, det_w_j_p | q39, q43, q62, q45, q44, q73, q72 | widen window, switch `every` to `any`, add sentence-initial "No," "Don't," "Avoid" to markers, or scope the check to first occurrence |
| Reference answer is a best-practice claim with no corpus support | det_c_j_i on q11, q52, q58 | q11, q52, q58, q41 | either ground these in a dedicated "house-style" corpus or reclassify as `judge_only` so deterministic grading is skipped |
| Judge penalises retrieval on closed-book runs | det_c_j_p | many | either skip `retrievalQuality` when `mode == closed_book`, or make `retrievalSupportsReferenceAnswer = N/A` for those runs |
| Judge tolerates secondary forbidden-API mentions | det_w_j_c (q39) | q39 | add an explicit instruction that any positive mention of `mustNotMention` counts, not just a primary recommendation |

---

## 9. Practical recommendations

1. **Treat the deterministic grade as a cheap sanity check, not as
   ground truth.** At 45% coarse agreement with the judge (kind-#1+2 folded
   in), it is precision-poor in both directions: it false-passes answers that
   negate their own keywords and false-fails answers that name the
   deprecated API in passing.
2. **Fix the warning-context heuristic first — it's a local change with a
   big effect.** Three concrete tweaks:
   (a) recognize sentence-initial `"No,"`, `"No."`, `"Don't"`, `"Avoid"`
   when classifying context;
   (b) use `any(...)` not `every(...)` so a single clearly-warning occurrence
   is enough to forgive;
   (c) drop the lone `"not "` marker — it forgives too much, including
   "not always" and "not only", which isn't the user's warning intent.
3. **Encode stance per question.** The cleanest structural fix is to add an
   `expectedStance: "affirmative" | "negative"` field for yes/no questions
   and require a negation within a small window of the keyword when the
   expected stance is `negative`. This would instantly correct q58, q11, q09,
   q57, q16 among the ones I examined.
4. **Promote some keywords from substrings to call-site patterns.** q20
   would work correctly if the rubric required `onChange\(of:[^)]*\)\s*\{\s*(?:[a-z_]+\s*,\s*[a-z_]+\s*in|\})` — the two-parameter or
   zero-parameter forms. The same shape helps q35
   (`scrollContentBackground\(\.visible`) and q8 (chained fill-then-stroke).
5. **Tag `best_practice` questions without corpus support.** Four of the
   top-10 `det_correct__judge_incorrect` questions have `questionType:
   best_practice` and empty `goldEvidence`. Either route them through the
   judge only, or accept that both graders are essentially grading adherence
   to house style on these questions.
6. **Teach the judge about the `mode` flag.** A one-line conditional in the
   prompt — *"If `mode == closed_book`, omit `retrievalQuality` and
   `retrievalSupportsReferenceAnswer` from the verdict"* — would stop
   ~30 of the `det_correct__judge_partial` cases from downgrading on the
   basis of retrieval evidence that was never expected.
7. **Make the aggregate CSV surface this disagreement explicitly.** Add
   `agreement: both_correct | both_wrong | det_only | judge_only | partial`
   to `aggregate-runs.csv` so model-vs-model comparisons on the same run set
   don't silently bake in the grader bias. (A 28–42% disagreement rate means
   the headline `meanAnswerScore` and `judgeCorrectRate` numbers are telling
   different stories.)

---

## 10. Reproducing

```bash
cd "/Users/daniel/Developer/LLM Benchmarking"
python3 tools/meta-analysis/combine-disagreements.py
# emits tools/meta-analysis/disagreements.json (324 rows)
#       tools/meta-analysis/per-question-disagreements.csv
```

Inputs:
- `benchmark-results/<execution>/aggregate-runs.jsonl` — produced by
  `scripts/aggregate-run.ts` after `grade.json` and `judge.json` exist.
- `benchmark/dataset/swiftui-docs-chatbot-benchmark.v1.json` — reference answers,
  gold evidence, question types.
- `benchmark/rubric/rubric.v1.json` — deterministic must/must-not lists.
- `corpus/swift-docs-2026-04-10/swiftui-macos-corpus/pages/**/*.md` — the
  frozen corpus used to verify claims.
