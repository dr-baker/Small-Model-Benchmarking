# Models Fall Into Their Own Traps

The single most striking finding from this benchmark: **models produced answers that contained the exact mistakes they were told to catch**, even though the benchmark prompt explicitly described each pitfall.

## The Setup

Every model received the same prompt: generate QA pairs for a SwiftUI documentation chatbot, using a benchmark that describes 42 scenarios across 70 questions. Each scenario names the outdated pattern and the modern replacement.

Despite this, three out of four models produced answers that reintroduced deprecated patterns from the same benchmark set.

## The Examples

### trinitylargehigh Q8 — Fixing one pitfall with another
The question warns about uncontrolled `.animation()`. The fix demonstrates the deprecated 1-parameter `onChange(of:) { newValue in }` variant — which is the exact pattern benchmark Q20 exists to flag. One pitfall fixed, another introduced.

### trinitylargehigh Q5 — Warning against Task-in-body, using GCD in the replacement
The answer warns about creating `Task` in the view body, then recommends `DispatchQueue.main.async` in the replacement code. `DispatchQueue.main.async` is precisely what benchmark Q44 exists to flag.

### mercury2 row 9 — Answering data-flow with the legacy pattern
Question: "Is `@ObservedObject` the right property wrapper for a mutable model?" Answer: "use `@StateObject`" — the exact legacy pattern benchmark Q10 exists to replace with `@Observable`.

### mercury2 row 20 — Warning against GCD while using GCD framing
The answer warns against `DispatchQueue.main.async` running on the main thread, then suggests "background queue" as an alternative — still using GCD terminology instead of the Swift concurrency model the benchmark promotes.

## Why This Happens

The models understood the surface-level question well enough to identify one deprecated pattern. But when generating the *replacement* code, they reached for whatever came next in their training distribution — and the training distribution is saturated with pre-iOS-17 SwiftUI patterns.

Being *told* the modern pattern in the prompt isn't enough to displace a strongly-reinforced older pattern. The model processes the prompt, outputs the correct identification, then regresses to the mean when generating substantive code.

## What This Means for AI Code Generation

1. **In-context prompts don't reliably override training priors.** Telling a model "don't use GCD" won't stop it from reaching for GCD when it needs to write async code. The instruction is weaker than the underlying pattern frequency in training data.

2. **Self-consistency is not a given.** A model can correctly name a bad pattern and then immediately produce code containing that exact pattern. These are two different generations with two different distributional pulls.

3. **Verbosity amplifies the problem.** The models that wrote longer code examples (trinity) introduced more errors than those that wrote terse answers (gpt54mini, 0 errors) — more code means more surface area for legacy patterns to leak through. See `verbose-examples-amplify-bugs.md`.

4. **Training cutoffs show in subtle places.** The models that did this most aren't obviously old — they just have training distributions biased toward pre-2024 SwiftUI. Any code generator will exhibit similar drift until the deprecated patterns age out of the training data.

## Defensive Implication

If you're building anything that generates SwiftUI code (or code for any fast-moving framework), **don't trust in-context prompt instructions to suppress legacy patterns**. You need:

- Post-generation linting against the deprecated API list
- Reference documentation injected into the generation context (RAG), not just rules
- Explicit examples of the modern pattern in the prompt, not just descriptions

The benchmark we used here is itself a good candidate for that reference material.
