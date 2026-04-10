# SwiftUI Docs Chatbot Benchmark: Scenarios & Questions

These scenarios simulate an AI coding agent working on SwiftUI tasks. The agent has outdated knowledge and tends to reach for deprecated or suboptimal patterns. Each scenario describes what the agent is building, then lists questions it might ask a Swift documentation chatbot. A good docs chatbot should steer the agent toward the modern, correct approach — not confirm its outdated assumptions.

---

## Scenario 1: Building a Tab-Based App Shell

The agent is tasked with creating a root view that has three tabs: Home, Search, and Profile. It wants each tab to have an icon and a label.

**Questions:**

1. "How do I add a `tabItem` modifier to a view inside a `TabView` to give it an icon and label?"
   - *Mistake:* Using the deprecated `tabItem()` modifier instead of the modern `Tab` API.

2. "I want to track which tab is selected using an integer with `TabView(selection:)`. How do I bind each tab to an index like 0, 1, 2?"
   - *Mistake:* Using integer selection instead of an enum for `TabView(selection:)`.

---

## Scenario 2: Navigation with a List of Items

The agent is building a master-detail view where tapping an item in a list navigates to a detail screen.

**Questions:**

3. "How do I wrap my list in a `NavigationView` and use `NavigationLink(destination:)` to push a detail view?"
   - *Mistake:* Using the deprecated `NavigationView` and `NavigationLink(destination:)` instead of `NavigationStack` with `navigationDestination(for:)`.

4. "I'm placing toolbar buttons using `.toolbar { ToolbarItem(placement: .navigationBarTrailing) { ... } }`. What placements are available?"
   - *Mistake:* Using the deprecated `.navigationBarTrailing` placement instead of `.topBarTrailing`.

---

## Scenario 3: Styling Text with Colors

The agent is creating a view with multicolored styled text elements.

**Questions:**

5. "How do I use `foregroundColor()` to set text color to a custom color from my asset catalog?"
   - *Mistake:* Using the deprecated `foregroundColor()` instead of `foregroundStyle()`.

6. "I want to display 'Hello' in red and 'World' in blue on the same line. Can I concatenate two `Text` views using the `+` operator?"
   - *Mistake:* Using the deprecated `Text` concatenation with `+` instead of text interpolation.

---

## Scenario 4: Building a Rounded Card Component

The agent is creating a reusable card view with rounded corners, a border, and an overlay badge.

**Questions:**

7. "How do I apply `cornerRadius()` to a `VStack` to round its corners?"
   - *Mistake:* Using the deprecated `cornerRadius()` instead of `clipShape(.rect(cornerRadius:))`.

8. "I want to add a stroke border around a `RoundedRectangle` — should I use an `.overlay` with a stroked shape on top?"
   - *Mistake:* Using an overlay for fill+stroke, which hasn't been needed since iOS 17 — you can chain `.fill()` and `.stroke()`.

9. "When creating a `RoundedRectangle`, should I pass `style: .continuous` for smooth corners?"
   - *Mistake:* Explicitly specifying `.continuous` when it's already the default.

---

## Scenario 5: Creating an Observable Data Model

The agent is building a shared data model class for a shopping cart that multiple views need to access.

**Questions:**

10. "How do I create a class conforming to `ObservableObject` with `@Published` properties, and pass it to views with `@EnvironmentObject`?"
    - *Mistake:* Using the old `ObservableObject`/`@Published`/`@EnvironmentObject` stack instead of `@Observable` with `@State` and `@Environment`.

11. "I have an `@Observable` class — do I need to annotate it with `@MainActor`?"
    - *Mistake:* Omitting `@MainActor` on `@Observable` classes (required unless the project uses Main Actor default isolation).

12. "Can I put an `@AppStorage` property inside my `@Observable` class so the view updates when UserDefaults changes?"
    - *Mistake:* Using `@AppStorage` inside `@Observable` — it won't trigger view updates even if marked `@ObservationIgnored`.

---

## Scenario 6: Handling User Input with Bindings

The agent is building a form where a text field updates a model and triggers a save.

**Questions:**

13. "How do I create a custom `Binding(get: { ... }, set: { ... })` in my view body to intercept changes to a text field and call a save method?"
    - *Mistake:* Using `Binding(get:set:)` in view body instead of using `@State`/`@Binding` with `onChange()`.

14. "I need a `TextField` for the user to enter their age as a number. Should I bind it to a `String` and convert with `Int()` afterward?"
    - *Mistake:* Not using the numeric `TextField` initializer with `format: .number` and appropriate `keyboardType`.

---

## Scenario 7: Building a Search Feature

The agent is implementing a searchable list that filters results based on user input.

**Questions:**

15. "I'm filtering an array of names using `name.contains(searchText)`. Is this the right approach for user-facing search?"
    - *Mistake:* Using `contains()` instead of `localizedStandardContains()`, which handles case, diacritics, and locale correctly.

16. "When the search returns no results, I want to show a custom 'No results found for [query]' view. What's the best way to build that?"
    - *Mistake:* Building a custom empty-state view instead of using `ContentUnavailableView.search`, which automatically includes the search term.

---

## Scenario 8: Formatting Dates and Numbers

The agent is displaying formatted dates, currency, and decimal values in a detail view.

**Questions:**

17. "How do I use `String(format: \"%.2f\", price)` to display a price with two decimal places in a `Text` view?"
    - *Mistake:* Using C-style `String(format:)` instead of `Text(value, format: .number.precision(.fractionLength(2)))` or `.currency()`.

18. "I'm creating a `DateFormatter` property to format dates for display. Should I store it as a `let` on my view to avoid recreating it?"
    - *Mistake:* Storing a `DateFormatter` instance when `Text(date, format: .dateTime.day().month().year())` is cleaner and more efficient.

19. "I want to show a date like '04/07/2026'. Should I use the date format string `\"MM/dd/yyyy\"`?"
    - *Mistake:* Using `"yyyy"` instead of `"y"` for years (incorrect in some locales), and using manual format strings instead of `FormatStyle` APIs.

---

## Scenario 9: Responding to State Changes

The agent wants to perform a side effect when a value changes.

**Questions:**

20. "How do I use the `onChange(of:perform:)` modifier that receives the new value as a parameter?"
    - *Mistake:* Using the deprecated 1-parameter `onChange()` variant instead of the 0-parameter or 2-parameter (old, new) variants.

---

## Scenario 10: Animating View Changes

The agent is building an animated score counter and a multi-step animation sequence.

**Questions:**

21. "I want to animate whenever `score` changes — can I just add `.animation(.bouncy)` to my view without specifying a value?"
    - *Mistake:* Using `animation()` without a `value:` parameter, which is deprecated and causes unpredictable animations.

22. "I want to chain two animations — scale up, then scale back down. Should I use `DispatchQueue.main.asyncAfter` to delay the second `withAnimation` call?"
    - *Mistake:* Using GCD for animation chaining instead of `withAnimation { } completion: { }`.

23. "I'm creating a custom `Shape` and need to implement `animatableData` manually. What protocol do I need to conform to?"
    - *Mistake:* Manually implementing `animatableData` instead of using the `@Animatable` macro.

---

## Scenario 11: Laying Out Views Relative to Screen Size

The agent wants a view that takes up half the screen width.

**Questions:**

24. "How do I use `UIScreen.main.bounds.width` to calculate half the screen width for my view's frame?"
    - *Mistake:* Using the deprecated `UIScreen.main.bounds` instead of `containerRelativeFrame()` or `GeometryReader`.

25. "I need to know the size of a parent view — should I wrap everything in a `GeometryReader`?"
    - *Mistake:* Reaching for `GeometryReader` first when `containerRelativeFrame()`, `visualEffect()`, or `Layout` protocol would work.

---

## Scenario 12: Making Views Accessible

The agent is adding icons and interactive elements to the UI.

**Questions:**

26. "I have a button that only shows an SF Symbol icon: `Button(action: delete) { Image(systemName: \"trash\") }`. Does this need any special accessibility work?"
    - *Mistake:* Creating an icon-only button without a text label, which is invisible to VoiceOver. Should be `Button("Delete", systemImage: "trash", action: delete)`.

27. "I want to make an image tappable. Should I add `onTapGesture { }` to the `Image`?"
    - *Mistake:* Using `onTapGesture()` instead of wrapping in a `Button`, which is inaccessible without `.accessibilityAddTraits(.isButton)`.

28. "I need a custom font size of 24 points. Can I just use `.font(.system(size: 24))`?"
    - *Mistake:* Hard-coding font size instead of using Dynamic Type with `@ScaledMetric` or `.font(.body.scaled(by:))`.

---

## Scenario 13: Building a Settings Form

The agent is building a settings screen with labeled sliders, toggles, and a text editor for notes.

**Questions:**

29. "I have a `Slider` inside a `Form` with a `Text` label in an `HStack`. How do I get the label and slider to lay out correctly?"
    - *Mistake:* Using `HStack` with `Text` + `Slider` instead of wrapping the control in `LabeledContent`.

30. "I need a multiline text input for user notes. Should I use `TextEditor`?"
    - *Mistake:* Using `TextEditor` when `TextField` with `axis: .vertical` would work and supports placeholder text.

---

## Scenario 14: Presenting Sheets and Alerts

The agent needs to show a detail sheet for an optional item and a delete confirmation dialog.

**Questions:**

31. "I have an optional `selectedItem` — should I use `sheet(isPresented:)` with an `if let` inside the sheet content?"
    - *Mistake:* Using `sheet(isPresented:)` with manual unwrapping instead of `sheet(item:)` which safely unwraps the optional.

32. "Where should I attach my `confirmationDialog()` modifier — on the root `NavigationStack`, or on the button that triggers it?"
    - *Mistake:* Attaching `confirmationDialog()` to a parent container instead of the specific UI element that triggers it (required for correct Liquid Glass animations).

---

## Scenario 15: Displaying a Long Scrollable List

The agent is building a feed view with hundreds of items in a `ScrollView`.

**Questions:**

33. "I have 500 items in a `ScrollView` with a `VStack`. The initial load is slow — what's going wrong?"
    - *Mistake:* Using `VStack` instead of `LazyVStack` inside `ScrollView` for large data sets.

34. "I want to hide the scroll indicators. Should I pass `showsIndicators: false` to the `ScrollView` initializer?"
    - *Mistake:* Using the old `showsIndicators` parameter instead of the `.scrollIndicators(.hidden)` modifier.

35. "My `ScrollView` has a solid white background. Is there anything I can do to optimize its scroll-edge rendering?"
    - *Mistake:* Not knowing about `scrollContentBackground(.visible)` for opaque static backgrounds.

---

## Scenario 16: Performing Async Work When a View Appears

The agent wants to load data from a network API when a view appears.

**Questions:**

36. "Should I use `onAppear { }` to call an async function that fetches data from my API?"
    - *Mistake:* Using `onAppear` for async work instead of `task()`, which supports `await` natively and cancels automatically on disappear.

37. "My view initializer fetches data from Core Data and sorts it. Is there a better place to put this work?"
    - *Mistake:* Doing non-trivial work in a view initializer instead of moving it to a `task()` modifier.

---

## Scenario 17: Conditional View Modifiers

The agent is toggling a view's opacity and color based on a boolean state.

**Questions:**

38. "I want to change a view's opacity based on a boolean. Should I use `if isActive { view.opacity(1) } else { view.opacity(0.5) }` in my body?"
    - *Mistake:* Using if/else view branching instead of a ternary `.opacity(isActive ? 1 : 0.5)`, which avoids `_ConditionalContent` and preserves structural identity.

39. "I have a function that returns `some View` that can be either a red or blue version of a view. I'm getting type errors — should I wrap the return in `AnyView`?"
    - *Mistake:* Using `AnyView` for type erasure instead of `@ViewBuilder`, `Group`, or generics.

---

## Scenario 18: Breaking Up a Large View

The agent has a 200-line `body` property and wants to decompose it.

**Questions:**

40. "My view body is very long. Should I extract parts into computed properties that return `some View`, decorated with `@ViewBuilder`?"
    - *Mistake:* Extracting into computed properties/methods (even with `@ViewBuilder`) instead of separate `View` structs in their own files.

41. "I have my `ContentView`, a `HeaderView`, and a `FooterView` all in the same Swift file. Is that OK?"
    - *Mistake:* Placing multiple type definitions in a single file instead of one type per file.

---

## Scenario 19: Working with Custom Environment Values

The agent wants to pass a custom theme value through the environment.

**Questions:**

42. "How do I create a custom `EnvironmentKey` struct with a `defaultValue`, then extend `EnvironmentValues` with a computed property to define a custom environment value?"
    - *Mistake:* Using the legacy manual `EnvironmentKey` pattern instead of the `@Entry` macro.

---

## Scenario 20: Using Haptic Feedback

The agent wants to provide tactile feedback when a user completes an action.

**Questions:**

43. "How do I create a `UIImpactFeedbackGenerator` to trigger haptic feedback when a button is tapped in SwiftUI?"
    - *Mistake:* Using UIKit's `UIImpactFeedbackGenerator` instead of SwiftUI's `sensoryFeedback()` modifier.

---

## Scenario 21: Using Swift Concurrency

The agent needs to perform background work and update the UI on the main thread.

**Questions:**

44. "I need to run some code on the main thread after a background task completes. Should I use `DispatchQueue.main.async { }`?"
    - *Mistake:* Using Grand Central Dispatch instead of modern Swift concurrency (`async`/`await`, `@MainActor`).

45. "I want to add a 2-second delay before retrying a network request. Should I use `Task.sleep(nanoseconds: 2_000_000_000)`?"
    - *Mistake:* Using `Task.sleep(nanoseconds:)` instead of `Task.sleep(for: .seconds(2))`.

46. "I have a shared mutable dictionary that multiple tasks read from and write to. Should I protect it with a `DispatchQueue` for thread safety?"
    - *Mistake:* Using GCD for synchronization instead of an `actor`.

---

## Scenario 22: Working with Strings and URLs

The agent is manipulating file paths and string content.

**Questions:**

47. "How do I get the user's documents directory using `FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first`?"
    - *Mistake:* Using the verbose `FileManager` lookup instead of `URL.documentsDirectory`.

48. "I need to replace all occurrences of a character in a string. Should I use `myString.replacingOccurrences(of: \"a\", with: \"b\")`?"
    - *Mistake:* Using the Foundation method `replacingOccurrences(of:with:)` instead of Swift-native `replacing("a", with: "b")`.

---

## Scenario 23: Iterating with ForEach

The agent needs to display a numbered list of items.

**Questions:**

49. "I want to iterate over an array with indices using `ForEach`. Should I convert `items.enumerated()` to an `Array` first, like `ForEach(Array(items.enumerated()), id: \\.offset)`?"
    - *Mistake:* Converting `enumerated()` to an Array unnecessarily. Should use `ForEach(items.enumerated(), id: \.element.id)` directly.

50. "My items don't conform to `Identifiable` — should I use `ForEach(items, id: \.name)` to identify them?"
    - *Mistake:* Using `id: \.someProperty` in SwiftUI instead of making the struct conform to `Identifiable`.

---

## Scenario 24: Displaying a Web Page

The agent wants to show a web page inside the app.

**Questions:**

51. "How do I wrap `WKWebView` in a `UIViewRepresentable` to display a web page in SwiftUI?"
    - *Mistake:* Creating a manual `UIViewRepresentable` wrapper when SwiftUI has a native `WebView` on iOS 26+.

---

## Scenario 25: Saving Sensitive User Data

The agent needs to store the user's API token and display preferences.

**Questions:**

52. "Can I store the user's authentication token in `@AppStorage` so it persists across launches?"
    - *Mistake:* Storing sensitive credentials in `@AppStorage` (which uses UserDefaults) instead of the Keychain.

---

## Scenario 26: Building an Icon + Text Row

The agent wants to display a label with an icon and text side by side.

**Questions:**

53. "Should I use an `HStack` with an `Image(systemName:)` and a `Text` to show an icon next to a label?"
    - *Mistake:* Using `HStack` + `Image` + `Text` instead of the semantic `Label` view, which handles layout and accessibility properly.

---

## Scenario 27: Handling Reduce Motion

The agent is adding a large fly-in animation to a hero element.

**Questions:**

54. "I have a large slide-in animation when my view appears. Do I need to check any user settings before playing it?"
    - *Mistake:* Not checking the `accessibilityReduceMotion` environment value and providing an opacity-based alternative.

---

## Scenario 28: Counting Array Matches

The agent needs to display how many items in a list match a filter condition.

**Questions:**

55. "I want to count how many tasks are completed. Should I use `tasks.filter { $0.isCompleted }.count`?"
    - *Mistake:* Using `filter { }.count` instead of the more efficient `count(where:)`.

---

## Scenario 29: Rendering a SwiftUI View to an Image

The agent wants to export a SwiftUI view as a PNG image.

**Questions:**

56. "How do I use `UIGraphicsImageRenderer` to capture a SwiftUI view as an image?"
    - *Mistake:* Using UIKit's `UIGraphicsImageRenderer` instead of SwiftUI's `ImageRenderer`.

---

## Scenario 30: SwiftData Model with CloudKit Sync

The agent is defining a SwiftData model that syncs via CloudKit.

**Questions:**

57. "I want to enforce uniqueness on my SwiftData model's `email` property. Should I add `@Attribute(.unique)` to it?"
    - *Mistake:* Using `@Attribute(.unique)` with CloudKit sync, which is not supported.

58. "My SwiftData model has a `tags` relationship defined as `var tags: [Tag]`. Does it need to be optional for CloudKit?"
    - *Mistake:* Non-optional relationships, which are required to be optional for CloudKit compatibility.

---

## Scenario 31: Using Person Names

The agent is building a contacts view that displays full names.

**Questions:**

59. "I have `firstName` and `lastName` strings. Should I display them as `Text(\"\\(firstName) \\(lastName)\")`?"
    - *Mistake:* Using simple string interpolation for person names instead of `PersonNameComponents` with proper formatting (name order varies by culture).

---

## Scenario 32: Building an Overlay Badge

The agent wants to put a notification badge on top of an icon.

**Questions:**

60. "I want to overlay a badge on an image. Should I use `.overlay(BadgeView(), alignment: .topTrailing)`?"
    - *Mistake:* Using the deprecated `overlay(_:alignment:)` with a view as the first argument instead of `overlay(alignment: .topTrailing) { BadgeView() }`.

---

## Scenario 33: @State Ownership and Privacy

The agent is passing `@State` properties between views.

**Questions:**

61. "I declared `@State var count = 0` in my view. A child view also needs to mutate it — should the child also declare `@State var count`?"
    - *Mistake:* Not understanding that `@State` should be `private` and owned by one view. The child should receive a `@Binding`.

---

## Scenario 34: Previews

The agent wants to add a preview for a new view.

**Questions:**

62. "How do I create a `PreviewProvider` struct with a `static var previews` to preview my SwiftUI view?"
    - *Mistake:* Using the legacy `PreviewProvider` protocol instead of the modern `#Preview` macro.

---

## Scenario 35: Menu Accessibility

The agent is creating a context menu button with just an ellipsis icon.

**Questions:**

63. "I'm creating a `Menu` with just `Image(systemName: \"ellipsis.circle\")` as its label. Is that sufficient?"
    - *Mistake:* Creating an icon-only `Menu` without a text label, making it inaccessible. Should use `Menu("Options", systemImage: "ellipsis.circle")`.

---

## Scenario 36: Color Differentiation in UI

The agent is building a status indicator that uses red/yellow/green dots.

**Questions:**

64. "I'm using colored circles to indicate status: red for error, yellow for warning, green for OK. Is this enough?"
    - *Mistake:* Using only color to differentiate meaning without respecting `accessibilityDifferentiateWithoutColor` — should add icons, patterns, or text as secondary indicators.

---

## Scenario 37: Using Asset Catalog Images

The agent is loading images from the asset catalog.

**Questions:**

65. "Should I load my asset catalog image using `Image(\"avatar\")` with a string name?"
    - *Mistake:* Using string-based image loading instead of the generated symbol API `Image(.avatar)` when the project is configured to use it.

---

## Scenario 38: Building a Generic Card Container

The agent is creating a reusable container view that accepts arbitrary content.

**Questions:**

66. "I'm building a `CardView<Content: View>` with a `let content: () -> Content` closure property. Is this the right way to accept `@ViewBuilder` content?"
    - *Mistake:* Storing an escaping closure `() -> Content` instead of storing the built view value directly with `@ViewBuilder let content: Content`.

---

## Scenario 39: Converting a String to a Date

The agent needs to parse an ISO 8601 date string from an API response.

**Questions:**

67. "I have an ISO 8601 date string and need to convert it to a `Date`. Should I create an `ISO8601DateFormatter` and call `date(from:)`?"
    - *Mistake:* Using the old `ISO8601DateFormatter` class instead of the modern `Date("2026-04-07T12:00:00Z", strategy: .iso8601)` initializer.

---

## Scenario 40: Silently Swallowing Errors

The agent is writing error handling for a file save operation triggered by a button tap.

**Questions:**

68. "In my `catch` block, I'm calling `print(error.localizedDescription)` to log the error. Is there anything else I should do?"
    - *Mistake:* Silently swallowing user-facing errors with `print()` instead of showing an alert or other UI feedback.

---

## Scenario 41: Using ObservableObject with Combine

The agent genuinely needs `ObservableObject` for a debounced search using Combine publishers.

**Questions:**

69. "I'm using `ObservableObject` with a Combine publisher for debouncing. My code compiles but I get a runtime error about missing Combine. What's wrong?"
    - *Mistake:* Not importing Combine explicitly — it used to be provided through SwiftUI but no longer is.

---

## Scenario 42: Hierarchical Text Styling

The agent wants to make secondary text slightly dimmer.

**Questions:**

70. "I want my subtitle text to be slightly transparent. Should I use `.opacity(0.6)` on the `Text`?"
    - *Mistake:* Using manual `.opacity()` instead of system hierarchical styles like `.foregroundStyle(.secondary)`, which adapt properly to context.

---

## Summary: Issue Coverage

| # | Issue Category | Questions |
|---|---------------|-----------|
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
