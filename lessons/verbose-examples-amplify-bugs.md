# Verbose Examples Amplify Bugs

> Historical note: this write-up analyzes the original 70-question bank used during early curation. The final tracked dataset in this repo contains 75 questions.

A clear pattern emerged when comparing the four models' outputs: **the more code a model wrote per answer, the more errors it introduced**.

## The Data

| Model | Qs | Code per Answer | Bad Rate |
|-------|----|----|----------|
| gpt54minihigh | 15 | None (prose only) | 0% |
| opus46 | 70 | Short, focused snippets | 0% |
| mercury2 | 34 | None (prose only) | 12% |
| trinitylargehigh | 8 | Long, multi-line examples with `class`, `do/catch`, force-unwraps | 25% |

Trinity's answers average 15-25 lines of Swift. Its bugs concentrate in that code:
- Q5: `DispatchQueue.main.async`, force-unwrapped `UIImage`, third-party library recommendation, manual `Task` cancellation boilerplate
- Q8: deprecated 1-parameter `onChange` inside an example that was otherwise about a different topic

gpt54minihigh's answers are 1-2 sentences with no code. It made zero errors — but only covered 15 of 70 benchmark topics.

## Why Length Correlates With Bugs

Every additional line of example code is another opportunity for a legacy pattern to leak through. The model correctly identifies the question's pitfall, but when it continues generating supporting code, each subsequent token is pulled by the training distribution rather than by the prompt's instructions.

A one-line answer like "Use `foregroundStyle()`" has almost no surface area. A 20-line example that *demonstrates* `foregroundStyle()` has 19 additional lines where the model might reach for `@StateObject`, `DispatchQueue`, `onChange { newValue in }`, or other legacy patterns — each of which is separately reinforced in training.

## The Tradeoff

Terse answers are safer but less useful:
- gpt54minihigh answers are correct but give a developer very little to copy-paste
- A developer asking "how do I use foregroundStyle?" probably wants to see it used, not just named

opus46 threaded this needle: its answers include code examples, but the examples are **tight and focused on the specific pitfall**. They don't expand into full example views with view models and async loaders — just enough to show the fix. Result: 70 questions covered, 0 bugs.

## Implication for Prompt Design

When prompting an LLM to generate reference content or documentation:

1. **Ask for minimal examples.** "Show the minimum code needed to demonstrate the fix" is safer than "show a realistic example" — realistic examples smuggle in unrelated legacy patterns.

2. **Cap example length explicitly.** A token or line budget forces focus.

3. **Separate "what to do" from "what not to do."** Don't let the model generate the bad example from its own training — provide it as an input. Otherwise the model may reach for slightly-wrong versions of the bad pattern that also appear in training (e.g., writing GCD code when the answer is about removing GCD).

4. **Treat long code blocks as higher-risk output.** They deserve proportionally more review.

## Related

- `models-fall-into-their-own-traps.md` — the specific mechanism by which legacy patterns leak through
