# Designing Questions for a Search Benchmark

When curating the final QA bank to benchmark an AI search agent, a core question emerged: **what separates a question that tests the search agent from one that a keyword lookup could trivially solve?**

## The Problem

Many of the model-generated questions were written in a form that gave the answer away by naming the relevant API:

- "How do I use `foregroundColor()` to set text color?"
- "Should I keep using `NavigationView` for iOS 26 compatibility?"
- "Can I use `String(format: "%.2f", price)`?"

A search agent handed questions like these doesn't need to understand the question at all. It just needs to find the document that also contains `foregroundColor`, `NavigationView`, or `String(format:)`. The benchmark reduces to a keyword-matching test, which tells you nothing about whether the agent understands *intent*.

Of the 127 total questions across all four models, roughly 55 fell into this "too on the nose" category.

## What Makes a Good Search-Benchmark Question

A good question describes a **goal, symptom, or approach** without naming the API that holds the answer. It forces the retrieval system to map natural developer language to documentation about a specific API.

Compare:

| Too on the nose | Good |
|-----------------|------|
| "How do I use `UIScreen.main.bounds`?" | "I need to size a view to half the available width. How do I measure the container?" |
| "Should I use `DispatchQueue.main.async` after a background task?" | "After a background network call completes, I need to update the UI. How do I ensure code runs on the main thread?" |
| "Is `.animation(.bouncy)` without a value okay?" | "I want to animate whenever `score` changes. Can I just add `.animation(.bouncy)` to my view?" |

The right-hand versions require semantic matching: the search agent must understand that "half the available width" maps to `containerRelativeFrame`, that "runs on the main thread" maps to `@MainActor` / `MainActor.run`, etc.

Note that the third example still mentions `.animation(.bouncy)` — but the question is about whether that approach works, not about finding documentation for `.animation()`. The answer (add `value:`) is orthogonal to the keyword in the question.

## Natural Code in Questions Is Still Fine

Developers often paste code when asking questions. Including a snippet like `Button(action: delete) { Image(systemName: "trash") }` in a question about accessibility is natural and realistic — and the snippet doesn't give the answer away because the answer is about *what's missing* (a text label), not about naming a different API.

The test is: **could a keyword match on any term in the question trivially return the correct document?** If yes, the question is too on the nose. If the match requires understanding the *relationship* between concepts in the question, it's a valid semantic benchmark.

## Follow-Up Probing Questions Are Underrated

mercury2's output used a format the other models didn't: instead of answering benchmark questions directly, it generated the *follow-up questions a developer might ask after receiving an initial answer*.

This format surfaced a class of misconceptions that direct questions don't catch:

- "Can I nest a `NavigationStack` inside a `NavigationView`?" (tests migration confusion)
- "Is it okay to do JSON parsing in `body` because SwiftUI caches views?" (tests a specific false belief about view lifecycle)
- "Does `Button` automatically read the SF Symbol name for VoiceOver?" (tests a common assumption about accessibility)

These are questions a developer asks *after* being told the right answer but still reaching for a workaround. They test whether the docs cover edge cases and common misconceptions, not just the happy path.

Five of mercury2's follow-ups made it into the final bank as Q71-Q75 — not because mercury2 had the best coverage, but because no other model asked these specific "but what about...?" questions.

## Implication for Benchmark Design

When building a search benchmark for any domain:

1. **Audit your questions for keyword-obvious phrasings.** If the question contains the answer's primary keyword, either edit it or drop it.

2. **Describe symptoms, not APIs.** A developer searching for help doesn't always know the API name — that's why they're searching. Write questions from that perspective.

3. **Include misconception probes.** "Is it okay if I do X because of Y?" questions surface whether the documentation addresses common false beliefs.

4. **Keep natural code snippets.** Realistic questions include code. The test is whether the keywords in that code trivially match the answer, not whether code is present.

5. **Leave some surface-level keyword questions in as a baseline.** If your benchmark has 75 questions and 10 of them are trivially keyword-matchable, you get a floor: any agent that can't score ~14% on those is broken. The other 65 are where the real evaluation happens.

## Related

- `benchmark/dataset/source/final-qa-bank.md` — the curated 75-question bank built using these principles
- `raw/model-qa-evaluation.md` — per-question classification showing which models produced keyword-obvious vs semantic questions
