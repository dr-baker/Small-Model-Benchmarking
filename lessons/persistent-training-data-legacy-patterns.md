# Persistent Legacy Patterns in SwiftUI Training Data

When models "fell into their own traps" (see `models-fall-into-their-own-traps.md`), they didn't reach for random bad patterns. They consistently reached for the *same* legacy patterns, across different models and different questions. These are the SwiftUI patterns whose training-data saturation is strong enough to defeat explicit in-context instructions.

## The Sticky Patterns

### 1. `@StateObject` / `@ObservedObject` / `@Published`
**Should be:** `@Observable`
**Observed in:** mercury2 row 9, trinitylargehigh Q3, trinitylargehigh Q7, opus46 Q69 (where still appropriate for Combine)

This is the most persistent legacy pattern. When asked about data flow, models default to the `ObservableObject` protocol — often even when the question is *about* replacing it. `@Observable` is the correct modern answer but appears less frequently in training data.

### 2. `DispatchQueue.main.async` / "background queue"
**Should be:** `await MainActor.run { }`, `@MainActor`, or `Task { }`
**Observed in:** trinitylargehigh Q5, mercury2 row 20

Despite Swift concurrency being the default recommendation since iOS 15, GCD terminology is deeply embedded. mercury2 row 20 is especially telling: it warns against `DispatchQueue.main.async` running on the main thread, then suggests "background queue" as the alternative — still thinking in GCD terms.

### 3. `onChange(of:) { newValue in }` — the 1-parameter variant
**Should be:** 0-parameter `{ }` or 2-parameter `{ oldValue, newValue in }`
**Observed in:** trinitylargehigh Q8

This is a subtle deprecation. The method name didn't change, only the closure signature. Models that have seen thousands of examples of the old signature produce it by default even in code that's supposed to demonstrate modern patterns.

### 4. `foregroundColor` instead of `foregroundStyle`
**Observed in:** Not produced in bad answers, but appears as the subject of the most "too on the nose" questions (mercury2 rows 1-3)

Interestingly, models know this one is deprecated — they flag it correctly and name the replacement. But its training-data saturation is so high that every model generated multiple questions *about* `foregroundColor`, suggesting it's the first thing that comes to mind when generating SwiftUI content.

### 5. Third-party image loading libraries
**Should be:** `AsyncImage` or `.task()` with `URL.downloaded`
**Observed in:** trinitylargehigh Q5 (recommends Kingfisher / SDWebImageSwiftUI)

These libraries were essential on iOS 13/14 before `AsyncImage` existed. Training data from that era still recommends them reflexively. Note that this isn't just a deprecation — it's recommending an unnecessary third-party dependency when a native solution exists.

### 6. `UIImage` force-unwraps
**Observed in:** trinitylargehigh Q5 (`Image(uiImage: uiImage!)`)

This isn't a SwiftUI pattern specifically — it's a Swift anti-pattern that leaks into UIKit bridging code. Training data is full of force-unwraps because they make examples shorter. Models reproduce them even when the surrounding context is about modern, safe Swift.

## Patterns That Did NOT Leak Through

Interesting negative results — patterns that are deprecated but models correctly avoided:
- `NavigationView` — every model that mentioned it correctly flagged it
- `cornerRadius()` — correctly flagged as deprecated
- `.tabItem()` — correctly flagged (though this appears to be newer deprecation)
- `@EnvironmentObject` — flagged alongside `@StateObject`

## Why These Specific Patterns?

The pattern of leakage seems to correlate with:

1. **How long the API has existed.** `@StateObject` was the recommendation from iOS 14 through iOS 16 — three years of intensive use. `NavigationView` was deprecated earlier and users migrated faster.

2. **How visually similar the old and new APIs are.** `onChange` still exists — only the closure signature changed. That's much harder to spot than `NavigationView` → `NavigationStack`, where the name itself changed.

3. **How much ancillary tutorial content exists.** `DispatchQueue` appears in thousands of Stack Overflow answers, blog posts, and older WWDC transcripts. The volume is hard to displace.

4. **Whether there's a clear one-to-one replacement.** `foregroundColor` → `foregroundStyle` is a trivial find-and-replace. `ObservableObject` → `@Observable` requires rethinking ownership (`@StateObject` → `@State`, `@EnvironmentObject` → `@Environment`, etc.). The complexity of the migration correlates with how often models get it wrong.

## Practical Use

If you're linting LLM-generated SwiftUI code, these are the patterns most worth specifically grep-ing for:

```
@StateObject
@ObservedObject
@Published
@EnvironmentObject
DispatchQueue.main.async
DispatchQueue.global
onChange(of: .*) \{ [a-zA-Z]+ in   # 1-parameter variant
UIScreen.main.bounds
NavigationView
foregroundColor
cornerRadius\(
.tabItem \{
Kingfisher
SDWebImage
UIImage\(.*\)!
```

Hits on any of these in freshly-generated code warrant a review even if the surrounding logic looks correct — these are the places where training-data bias reliably breaks through in-context instructions.

## Related

- `models-fall-into-their-own-traps.md` — the mechanism by which these patterns leak through
- `verbose-examples-amplify-bugs.md` — why longer code examples expose more of these patterns
