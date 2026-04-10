# SwiftUI Docs Chatbot Benchmark: Model Analysis

## Overview

Four models were given the same prompt: generate QA pairs for a SwiftUI documentation chatbot benchmark. The benchmark (`swiftui-benchmark-scenarios.md`) defines 70 questions across 42 scenarios, each targeting a specific outdated or incorrect SwiftUI pattern. A good QA response should steer developers toward modern, correct alternatives.

Each model's output was reviewed against the benchmark scenarios and validated against current SwiftUI best practices (iOS 26, Swift 6.2). Two metrics are tracked:

- **Coverage**: How many of the 70 benchmark questions the model's QA addresses.
- **Bad Answers**: Answers that misidentify the pitfall, recommend the wrong fix, or contain deprecated/incorrect code in their solutions.

## Summary

| Model | Total Qs | Benchmark Coverage (of 70) | Bad Answers | Bad Rate |
|-------|----------|---------------------------|-------------|----------|
| opus46 | 70 | 70 | 0 | 0% |
| gpt54minihigh | 15 | 15 | 0 | 0% |
| mercury2 | 34 | 12 | 4 | 12% |
| trinitylargehigh | 8 | 7 | 2 | 25% |

## Coverage by Issue Category

Each cell shows `covered / bad`.

| Category | Total Qs | opus46 | gpt54minihigh | mercury2 | trinitylargehigh |
|----------|----------|--------|---------------|----------|------------------|
| Deprecated API | 15 | 15 / 0 | 1 / 0 | 2 / 0 | 2 / 0 |
| View Structure | 4 | 4 / 0 | 2 / 0 | 3 / 1 | 1 / 1 |
| Data Flow | 8 | 8 / 0 | 2 / 0 | 3 / 1 | 2 / 0 |
| Navigation | 4 | 4 / 0 | 1 / 0 | 1 / 0 | 1 / 0 |
| Design | 6 | 6 / 0 | 2 / 0 | 1 / 1 | 0 / 0 |
| Accessibility | 6 | 6 / 0 | 3 / 0 | 1 / 0 | 1 / 1 |
| Performance | 7 | 7 / 0 | 1 / 0 | 1 / 0 | 1 / 1 |
| Swift Language | 12 | 12 / 0 | 2 / 0 | 2 / 2 | 0 / 0 |
| Hygiene | 3 | 3 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Animation | 3 | 3 / 0 | 1 / 0 | 0 / 0 | 1 / 1 |

## Per-Model Analysis

### opus46

Full 70/70 coverage with zero bad answers. Every benchmark question is addressed with the correct modern pattern. Answers are detailed, include code examples, and consistently recommend the right APIs (`@Observable`, `foregroundStyle`, `NavigationStack`, `.task()`, `Button("Label", systemImage:)`, etc.).

### gpt54minihigh

15 questions, all correct. The output is terse by design (short answer + pitfall) but every answer correctly identifies the deprecated pattern and recommends the modern replacement. Notably strong on accessibility (covers Q26, Q27, Q64) and correctly uses `onChange()` in its Binding answer. Limited coverage but zero errors within scope.

Benchmark questions covered: Q1, Q12, Q13, Q15, Q17, Q21, Q24, Q26, Q27, Q29, Q31, Q36, Q40, Q64, Q66.

### mercury2

34 follow-up probing questions covering 12 unique benchmark topics. The format is different from the other models: rather than answering the benchmark questions directly, it generates follow-up questions a developer might ask after receiving an initial answer. This is a useful format for stress-testing a chatbot, but it maps to fewer unique benchmark issues.

4 bad answers where the model fell into the patterns it was supposed to flag:

| Row | Benchmark Q | What Went Wrong |
|-----|------------|-----------------|
| 9 | Q10 (Observable) | Recommends `@StateObject` for mutable models instead of `@Observable` |
| 13 | Q28 (Font Size) | Says "use design tokens" without mentioning `@ScaledMetric` or Dynamic Type |
| 18 | Q49 (ForEach) | Misses the `\.offset` vs `\.element.id` distinction entirely |
| 20 | Q44 (Concurrency) | Suggests "background queue" (GCD terminology) alongside `Task` |

### trinitylargehigh

8 questions covering 7 benchmark issues. The smallest output of any model.

2 bad answers:

| Q# | Benchmark Q | What Went Wrong |
|----|------------|-----------------|
| 5 | Q36 (Async) | Example uses `DispatchQueue.main.async` and force-unwraps `UIImage`. Recommends third-party image libraries instead of `.task()` or `AsyncImage`. |
| 8 | Q21 (Animation) | Example uses the deprecated 1-parameter `onChange(of:) { newValue in }` variant. |

## The Irony: Falling Into Your Own Traps

The benchmark prompt explicitly describes each pitfall and the outdated pattern to avoid. Despite this, several models produced answers that contain the very mistakes they were told to catch:

- **trinitylargehigh Q8** warns about uncontrolled `.animation()` but demonstrates the fix using the deprecated 1-parameter `onChange()` variant -- a different pitfall from the same benchmark (Q20). The answer fixes one issue while introducing another from the list.

- **trinitylargehigh Q5** warns about creating `Task` in the view body but recommends `DispatchQueue.main.async` in the replacement code -- the exact GCD pattern that benchmark Q44 flags as a mistake.

- **mercury2 row 9** answers a question about data flow patterns by recommending `@StateObject`, which is the legacy pattern that benchmark Q10 exists specifically to replace with `@Observable`.

- **mercury2 row 20** warns against `DispatchQueue.main.async` running on the main thread, then suggests "background queue" as an alternative -- still using GCD framing rather than the Swift concurrency model the benchmark promotes.

In each case, the model understood the question well enough to identify the surface-level issue, but its suggested code reintroduced a different deprecated pattern from the same benchmark set. This suggests these models are drawing on outdated training data for their SwiftUI code generation, even when the prompt provides the correct modern patterns.

## Benchmark Reference

The full benchmark with all 70 questions and issue categories is in `swiftui-benchmark-scenarios.md`.

| # | Issue Category | Benchmark Questions |
|---|---------------|---------------------|
| 1 | Deprecated API | 1, 2, 3, 4, 5, 6, 7, 8, 9, 20, 34, 42, 43, 51, 60 |
| 2 | View Structure | 10, 40, 41, 66 |
| 3 | Data Flow | 10, 11, 12, 13, 14, 19, 50, 61 |
| 4 | Navigation | 3, 4, 31, 32 |
| 5 | Design | 24, 25, 29, 30, 53, 70 |
| 6 | Accessibility | 26, 27, 28, 54, 63, 64 |
| 7 | Performance | 33, 34, 35, 36, 37, 38, 39 |
| 8 | Swift Language | 17, 18, 44, 45, 46, 47, 48, 49, 55, 59, 67, 68 |
| 9 | Hygiene | 52, 57, 58 |
| 10 | Animation | 21, 22, 23 |
