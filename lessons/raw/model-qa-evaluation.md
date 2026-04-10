# Model QA Evaluation for Final Bank

Each model's questions were evaluated for inclusion in the final QA bank, which is designed to benchmark an AI search agent. Questions must require **semantic search** to answer — keyword-obvious questions ("How do I use `foregroundColor()`?") are flagged as "too on the nose."

## Summary

| Model | Total Qs | Good | Too On The Nose | Redundant | Bad Question | Bad Answer |
|-------|----------|------|-----------------|-----------|--------------|------------|
| opus46 | 70 | 31 | 39 | 0 | 0 | 0 |
| gpt54minihigh | 15 | 1 | 7 | 7 | 0 | 0 |
| mercury2 | 34 | 5 | 7 | 16 | 2 | 4 |
| trinitylargehigh | 8 | 0 | 2 | 4 | 0 | 2 |

- **Good**: Used as-is or contributed a better phrasing to the final bank.
- **Too On The Nose**: Question names the deprecated/incorrect API directly, making keyword search trivial. For opus46, all 39 were edited into good questions for the bank.
- **Redundant**: Covers the same benchmark topic as an opus46 question with equal or lesser quality.
- **Bad Question**: Irrelevant or trivially answerable without SwiftUI knowledge.
- **Bad Answer**: Recommends the wrong pattern or contains deprecated code in the solution.

## Final Bank Composition

75 questions total:
- 70 from opus46 (31 as-is + 39 with edited questions, all answers unchanged)
- 1 better phrasing from gpt54minihigh (Q2 → bank Q13)
- 5 unique follow-up questions from mercury2 (Q71–Q75)
- 0 from trinitylargehigh

---

## opus46 — Per-Question Evaluation

All 70 answers are correct. 31 questions were natural enough for semantic search; 39 had keywords that made matching trivial and were edited for the final bank.

| Q# | Topic | Verdict | Reason |
|----|-------|---------|--------|
| 1 | Tab Item | Edited | Names `tabItem` directly |
| 2 | TabView Selection | Edited | Names `TabView(selection:)` with integer pattern |
| 3 | NavigationView | Edited | Names `NavigationView` and `NavigationLink(destination:)` |
| 4 | Toolbar Placement | Edited | Names `.navigationBarTrailing` |
| 5 | Text Color | Edited | Names `foregroundColor()` |
| 6 | Text Concatenation | Edited | Names `+` operator on Text |
| 7 | Corner Radius | Edited | Names `cornerRadius()` |
| 8 | Fill and Stroke | Good | Asks about overlay approach, doesn't name solution |
| 9 | RoundedRectangle Corner Style | Edited | Names `style: .continuous` |
| 10 | Observable | Edited | Names `ObservableObject`, `@Published`, `@EnvironmentObject` |
| 11 | @MainActor | Good | Asks whether annotation is needed — answer not in question |
| 12 | @AppStorage in @Observable | Good | Asks about a combination — failure isn't keyword-obvious |
| 13 | Custom Binding | Edited | Names `Binding(get:set:)`. Used gpt54minihigh phrasing instead. |
| 14 | Numeric TextField | Good | Describes goal (numeric input), doesn't name format parameter |
| 15 | Search Filtering | Good | Names `contains()` but answer (`localizedStandardContains`) requires understanding |
| 16 | Empty Search Results | Good | Describes intent, doesn't name `ContentUnavailableView` |
| 17 | Price Formatting | Edited | Names `String(format:)` |
| 18 | DateFormatter | Edited | Names `DateFormatter` |
| 19 | Date Format Strings | Edited | Names `"MM/dd/yyyy"` format string |
| 20 | onChange | Edited | Names `onChange(of:perform:)` with parameter signature |
| 21 | Animation Without Value | Good | Describes the problem, answer requires knowing about `value:` parameter |
| 22 | Animation Chaining | Good | Asks about `DispatchQueue.main.asyncAfter` for timing — natural question |
| 23 | Animatable Shape | Edited | Names `animatableData` |
| 24 | Screen Bounds | Edited | Names `UIScreen.main.bounds` |
| 25 | GeometryReader | Edited | Names `GeometryReader` |
| 26 | Icon-Only Button | Good | Describes scenario (icon-only button), asks about accessibility |
| 27 | Tappable Image | Edited | Names `onTapGesture` |
| 28 | Custom Font Size | Edited | Names `.font(.system(size:))` |
| 29 | Slider in Form | Good | Describes layout problem, doesn't name `LabeledContent` |
| 30 | Multiline Text | Edited | Names `TextEditor` |
| 31 | Sheet with Optional | Edited | Names `sheet(isPresented:)` |
| 32 | Confirmation Dialog Placement | Good | Asks about placement — answer requires knowing about Liquid Glass |
| 33 | Slow ScrollView | Good | Describes symptom (slow load), doesn't name `LazyVStack` |
| 34 | Scroll Indicators | Edited | Names `showsIndicators: false` |
| 35 | Scroll Background | Good | Describes optimization opportunity, doesn't name modifier |
| 36 | Async on Appear | Edited | Names `onAppear` |
| 37 | View Init Work | Good | Describes symptom (work in init), answer requires knowing `.task()` |
| 38 | Conditional Modifier | Good | Describes if/else approach — pitfall is structural identity, not keyword |
| 39 | AnyView | Edited | Names `AnyView` |
| 40 | View Body Extraction | Good | Asks about computed properties — answer (separate structs) requires understanding |
| 41 | Multiple Types in File | Good | Describes scenario, answer is organizational |
| 42 | Custom Environment Values | Edited | Names `EnvironmentKey` |
| 43 | Haptic Feedback | Edited | Names `UIImpactFeedbackGenerator` |
| 44 | Main Thread Dispatch | Edited | Names `DispatchQueue.main.async` |
| 45 | Task Sleep | Edited | Names `Task.sleep(nanoseconds:)` |
| 46 | Shared Mutable State | Edited | Names `DispatchQueue` for synchronization |
| 47 | Documents Directory | Edited | Names `FileManager.default.urls(for:...)` |
| 48 | String Replacement | Edited | Names `replacingOccurrences(of:with:)` |
| 49 | ForEach with Enumerated | Good | Asks about `Array(items.enumerated())` — pitfall is `\.offset` vs `\.element.id` |
| 50 | Identifiable | Edited | Names `id: \.name` pattern at call site |
| 51 | Web Page Display | Edited | Names `WKWebView` and `UIViewRepresentable` |
| 52 | Auth Token Storage | Good | Asks about `@AppStorage` for tokens — security issue requires understanding |
| 53 | Icon + Text Layout | Good | Describes HStack approach — answer (`Label`) requires understanding |
| 54 | Reduce Motion | Good | Asks about user settings before animation — doesn't name the environment value |
| 55 | Counting Matches | Edited | Names `filter { }.count` |
| 56 | Render to Image | Edited | Names `UIGraphicsImageRenderer` |
| 57 | SwiftData Unique + CloudKit | Good | Asks about `@Attribute(.unique)` — CloudKit incompatibility is non-obvious |
| 58 | SwiftData Relationships + CloudKit | Good | Asks about optional relationships — CloudKit requirement is non-obvious |
| 59 | Person Name Display | Good | Describes interpolation approach — i18n issue requires understanding |
| 60 | Overlay Syntax | Edited | Names old `.overlay(View, alignment:)` syntax |
| 61 | @State Ownership | Good | Describes child needing to mutate — answer requires understanding ownership |
| 62 | Previews | Edited | Names `PreviewProvider` |
| 63 | Menu Accessibility | Good | Describes icon-only Menu — accessibility gap requires understanding |
| 64 | Color-Only Status | Good | Describes colored circles — accessibility issue requires understanding |
| 65 | Asset Catalog Images | Edited | Names `Image("string")` pattern |
| 66 | ViewBuilder Closure | Good | Describes `() -> Content` storage — answer requires understanding |
| 67 | ISO 8601 Parsing | Edited | Names `ISO8601DateFormatter` |
| 68 | Error Handling | Good | Describes `print()` in catch — answer requires understanding UX responsibility |
| 69 | Combine Import | Good | Describes runtime error symptom — requires understanding implicit imports |
| 70 | Hierarchical Opacity | Good | Asks about `.opacity()` — answer (`.secondary`) requires understanding |

---

## gpt54minihigh — Per-Question Evaluation

15 questions, all answers correct. Terse format (short answer + pitfall).

| Q# | Topic | Verdict | Reason |
|----|-------|---------|--------|
| 1 | Search filtering | Too on the nose | Names both `contains()` and `localizedStandardContains()` |
| 2 | Custom binding | Good | "Can I create a custom binding inline so I can save on every keystroke?" — describes intent, preferred over opus46 |
| 3 | Tab API | Too on the nose | Names `.tabItem()` |
| 4 | ViewBuilder content | Redundant | Same topic as opus46 Q66, less detailed |
| 5 | Animation value | Too on the nose | Names `.animation(.easeInOut)` without value |
| 6 | @AppStorage + @Observable | Redundant | Same topic as opus46 Q12, same quality |
| 7 | Sheet item | Redundant | Same topic as opus46 Q31, less detailed |
| 8 | Screen bounds | Too on the nose | Names `UIScreen.main.bounds.width` |
| 9 | String formatting | Too on the nose | Names `String(format:)` |
| 10 | Icon-only button | Redundant | Same topic as opus46 Q26. Nice phrasing but less descriptive. |
| 11 | Async on appear | Too on the nose | Names both `onAppear()` and `task()` |
| 12 | Big body | Redundant | Same topic as opus46 Q40 |
| 13 | Button vs onTapGesture | Too on the nose | Names both `onTapGesture()` and `Button` |
| 14 | Color-only status | Redundant | Same topic as opus46 Q64 |
| 15 | LabeledContent | Too on the nose | Names the solution `LabeledContent` in the question |

---

## mercury2 — Per-Question Evaluation

34 follow-up probing questions in table format. Maps to 12 unique benchmark topics. 4 bad answers.

| Row | Topic | Verdict | Reason |
|-----|-------|---------|--------|
| 1 | foregroundColor | Too on the nose | Names `foregroundColor` directly |
| 2 | foregroundColor iOS 26 | Too on the nose | Names `foregroundColor` directly |
| 3 | foregroundStyle import | Too on the nose | Names `foregroundStyle` directly |
| 4 | accessibilityLabel placement | **Good** | Tests where to attach labels — unique angle not in opus46 |
| 5 | Button VoiceOver auto-read | Redundant | Similar to opus46 Q26, less actionable |
| 6 | accessibilityHidden anti-pattern | **Good** | Tests dangerous anti-pattern — unique angle |
| 7 | Binding(get:set:) in body | Too on the nose | Names the exact pattern |
| 8 | model.save() in set closure | Redundant | Similar to opus46 Q13 binding topic |
| 9 | @ObservedObject for editing | **Bad answer** | Recommends `@StateObject` instead of `@Observable` |
| 10 | NavigationView for iOS 26 | Too on the nose | Names `NavigationView` |
| 11 | Nesting NavigationStack in NavigationView | **Good** | Tests common migration misconception — unique |
| 12 | NavigationLink without id | Redundant | Covered by opus46 Q50 (Identifiable) |
| 13 | Custom font size in view | **Bad answer** | Says "design tokens" without mentioning `@ScaledMetric` |
| 14 | Multiple structs in one file | Redundant | Same as opus46 Q41 |
| 15 | ColorAsset for dark mode | Redundant | Tangential to opus46 Q5 (foregroundStyle) |
| 16 | Dropping id: \.self | Redundant | Related to opus46 Q49/Q50 |
| 17 | Position-based identity | Redundant | Related to opus46 Q49 |
| 18 | Array.enumerated() for IDs | **Bad answer** | Misses `\.offset` vs `\.element.id` distinction |
| 19 | JSON parsing in body | **Good** | Tests misconception about body caching — unique angle |
| 20 | DispatchQueue.main.async for parsing | **Bad answer** | Uses GCD "background queue" framing |
| 21 | @State with async loader | Redundant | Related to opus46 Q36/Q37 |
| 22 | UIKit import for colors | Too on the nose | Names UIKit import |
| 23 | SwiftUI-only teal color | Redundant | Related to opus46 Q5 color topic |
| 24 | UIKit app size impact | Bad question | Not relevant to SwiftUI best practices |
| 25 | Async in button action | **Good** | Tests concurrency understanding — useful unique angle |
| 26 | Marking closure as async | Redundant | Similar to row 25, less precise |
| 27 | UI freeze without Task | Redundant | Similar to row 25, less actionable |
| 28 | Networking in view struct | Redundant | Architecture advice, similar to opus46 Q40/Q41 |
| 29 | MARK comments for compiler | Bad question | Trivial — MARK comments are basic Swift knowledge |
| 30 | ViewModel for fetch logic | Redundant | Generic architecture question |
| 31 | UI freeze (duplicate) | Too on the nose | Names `DispatchQueue.main.async` |
| 32 | Project organization | Redundant | Same as opus46 Q41 |
| 33 | MARK for organization | Redundant | Trivial tooling question |
| 34 | ViewModel separation | Redundant | Duplicate of row 30 |

---

## trinitylargehigh — Per-Question Evaluation

8 questions in verbose format with code examples. 2 bad answers.

| Q# | Topic | Verdict | Reason |
|----|-------|---------|--------|
| 1 | Text color + font | Redundant | Same as opus46 Q5. Scenario-style but answer claims modifier order matters (debatable). |
| 2 | Navigation (UIKit) | Redundant | Same as opus46 Q3. Mentions UINavigationController which is a different angle but opus46 covers NavigationStack. |
| 3 | Binding(get:set:) | Too on the nose | Names `Binding(get:set:)` and `@StateObject`/`@ObservedObject` in the question |
| 4 | List style + nav title | Redundant | Covers list styling and nav titles — tangential to opus46 Q3/Q29 |
| 5 | Async image loading | **Bad answer** | Uses `DispatchQueue.main.async`, `UIImage` force-unwrap, recommends third-party libraries |
| 6 | Icon-only button | Redundant | Same as opus46 Q26. Uses `.accessibilityLabel()` instead of `Button("Label", systemImage:)` in answer. |
| 7 | @ObservedObject/@Published | Too on the nose | Names `@ObservedObject`, `@Published`, `@StateObject` |
| 8 | Animation + onChange | **Bad answer** | Example uses deprecated 1-parameter `onChange(of:) { newValue in }` |
