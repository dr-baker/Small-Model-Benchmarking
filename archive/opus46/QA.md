# SwiftUI Docs Chatbot Benchmark: Q&A

Each entry contains:
- **Question**: What the AI agent asks the docs chatbot
- **Answer**: The correct, modern answer the chatbot should give
- **Pitfall**: The outdated or incorrect pattern the agent was about to use

---

## 1. Tab Item Modifier

**Question:** How do I add a `tabItem` modifier to a view inside a `TabView` to give it an icon and label?

**Answer:** The `tabItem()` modifier is deprecated. Use the `Tab` view API instead. Each tab is declared as a `Tab` with a title, system image, and content:

```swift
TabView {
    Tab("Home", systemImage: "house") {
        HomeView()
    }
    Tab("Search", systemImage: "magnifyingglass") {
        SearchView()
    }
    Tab("Profile", systemImage: "person") {
        ProfileView()
    }
}
```

**Pitfall:** Using the deprecated `tabItem()` modifier, e.g. `HomeView().tabItem { Label("Home", systemImage: "house") }`.

---

## 2. TabView Selection Type

**Question:** I want to track which tab is selected using an integer with `TabView(selection:)`. How do I bind each tab to an index like 0, 1, 2?

**Answer:** Rather than binding to an integer, define an enum for your tabs and use that as the selection type. This is type-safe and self-documenting:

```swift
enum AppTab {
    case home, search, profile
}

@State private var selectedTab = AppTab.home

TabView(selection: $selectedTab) {
    Tab("Home", systemImage: "house", value: .home) {
        HomeView()
    }
    Tab("Search", systemImage: "magnifyingglass", value: .search) {
        SearchView()
    }
    Tab("Profile", systemImage: "person", value: .profile) {
        ProfileView()
    }
}
```

**Pitfall:** Using `Int` or `String` for tab selection values like `value: 0`, `value: 1`, `value: 2`, which is fragile and unclear.

---

## 3. NavigationView with NavigationLink

**Question:** How do I wrap my list in a `NavigationView` and use `NavigationLink(destination:)` to push a detail view?

**Answer:** `NavigationView` is deprecated. Use `NavigationStack` with `navigationDestination(for:)` instead. Use a value-based `NavigationLink` that pushes a data value onto the navigation path, and register a destination for that type:

```swift
NavigationStack {
    List(items) { item in
        NavigationLink(item.name, value: item)
    }
    .navigationDestination(for: Item.self) { item in
        DetailView(item: item)
    }
}
```

This approach also supports programmatic navigation via a `NavigationPath`. Do not mix `NavigationLink(destination:)` and `navigationDestination(for:)` in the same hierarchy — it causes significant problems.

**Pitfall:** Using the deprecated `NavigationView` and `NavigationLink(destination: DetailView(item: item)) { Text(item.name) }` pattern.

---

## 4. Toolbar Placement

**Question:** I'm placing toolbar buttons using `.toolbar { ToolbarItem(placement: .navigationBarTrailing) { ... } }`. What placements are available?

**Answer:** The placements `.navigationBarLeading` and `.navigationBarTrailing` are deprecated. Use `.topBarLeading` and `.topBarTrailing` instead:

```swift
.toolbar {
    ToolbarItem(placement: .topBarTrailing) {
        Button("Edit", action: editAction)
    }
}
```

Other common placements include `.bottomBar`, `.principal`, `.confirmationAction`, `.cancellationAction`, and `.destructiveAction`.

**Pitfall:** Using the deprecated `.navigationBarLeading` and `.navigationBarTrailing` placements.

---

## 5. Setting Text Color

**Question:** How do I use `foregroundColor()` to set text color to a custom color from my asset catalog?

**Answer:** `foregroundColor()` is deprecated. Use `foregroundStyle()` instead, which works with any `ShapeStyle` including colors, gradients, and hierarchical styles:

```swift
Text("Hello")
    .foregroundStyle(.red)

Text("Custom Color")
    .foregroundStyle(Color("BrandBlue"))
```

**Pitfall:** Using the deprecated `foregroundColor()` modifier.

---

## 6. Concatenating Styled Text

**Question:** I want to display 'Hello' in red and 'World' in blue on the same line. Can I concatenate two `Text` views using the `+` operator?

**Answer:** `Text` concatenation with `+` is deprecated. Use text interpolation instead:

```swift
var body: some View {
    let hello = Text("Hello").foregroundStyle(.red)
    let world = Text("World").foregroundStyle(.blue)
    Text("\(hello) \(world)")
}
```

This preserves individual styling while composing them into a single `Text` view.

**Pitfall:** Using `Text("Hello").foregroundStyle(.red) + Text("World").foregroundStyle(.blue)`.

---

## 7. Rounding Corners

**Question:** How do I apply `cornerRadius()` to a `VStack` to round its corners?

**Answer:** `cornerRadius()` is deprecated. Use `clipShape()` with a rounded rectangle instead:

```swift
VStack {
    // content
}
.clipShape(.rect(cornerRadius: 12))
```

**Pitfall:** Using the deprecated `cornerRadius()` modifier.

---

## 8. Fill and Stroke a Shape

**Question:** I want to add a stroke border around a `RoundedRectangle` — should I use an `.overlay` with a stroked shape on top?

**Answer:** Since iOS 17, you can chain `.fill()` and `.stroke()` on a shape directly — no overlay needed:

```swift
RoundedRectangle(cornerRadius: 12)
    .fill(.blue)
    .stroke(.white, lineWidth: 2)
```

**Pitfall:** Using an `.overlay` with a separate stroked shape, which was required before iOS 17 but is no longer necessary.

---

## 9. RoundedRectangle Corner Style

**Question:** When creating a `RoundedRectangle`, should I pass `style: .continuous` for smooth corners?

**Answer:** The default corner style for `RoundedRectangle` is already `.continuous`, so there's no need to specify it explicitly:

```swift
// This is sufficient — .continuous is the default
RoundedRectangle(cornerRadius: 12)
```

**Pitfall:** Explicitly passing `style: .continuous` when it's already the default.

---

## 10. Observable Data Model

**Question:** How do I create a class conforming to `ObservableObject` with `@Published` properties, and pass it to views with `@EnvironmentObject`?

**Answer:** The `ObservableObject`/`@Published`/`@EnvironmentObject` pattern is legacy. Use the `@Observable` macro instead:

```swift
@Observable
@MainActor
class ShoppingCart {
    var items: [Item] = []
    var total: Double = 0
}
```

Use `@State` for ownership and `@Environment` for passing through the environment:

```swift
// Owner view
@State private var cart = ShoppingCart()

var body: some View {
    ChildView()
        .environment(cart)
}

// Consumer view
@Environment(ShoppingCart.self) private var cart
```

**Pitfall:** Using `ObservableObject`, `@Published`, `@StateObject`, `@ObservedObject`, and `@EnvironmentObject`.

---

## 11. @MainActor on @Observable

**Question:** I have an `@Observable` class — do I need to annotate it with `@MainActor`?

**Answer:** Yes. `@Observable` classes must be marked `@MainActor` to ensure their properties are accessed on the main thread, which is required for safe UI updates. The only exception is if your project uses Main Actor default actor isolation (a Swift 6 build setting).

```swift
@Observable
@MainActor
class UserSettings {
    var theme: Theme = .system
    var fontSize: Int = 14
}
```

**Pitfall:** Omitting `@MainActor` on `@Observable` classes, which can lead to data races and concurrency warnings under strict concurrency checking.

---

## 12. @AppStorage Inside @Observable

**Question:** Can I put an `@AppStorage` property inside my `@Observable` class so the view updates when UserDefaults changes?

**Answer:** No. `@AppStorage` inside an `@Observable` class will not trigger view updates, even if marked `@ObservationIgnored`. `@AppStorage` is designed to work inside SwiftUI views, not `@Observable` classes. Instead, read from `UserDefaults` directly in the class and use `@AppStorage` in the view layer, or use a different mechanism to bridge UserDefaults changes.

**Pitfall:** Placing `@AppStorage` inside an `@Observable` class and expecting it to trigger view refreshes.

---

## 13. Custom Binding in View Body

**Question:** How do I create a custom `Binding(get: { ... }, set: { ... })` in my view body to intercept changes to a text field and call a save method?

**Answer:** Avoid `Binding(get:set:)` in view body — it's fragile and harder to maintain. Instead, use a standard binding from `@State` or `@Binding`, and react to changes with `onChange()`:

```swift
@State private var username = ""

var body: some View {
    TextField("Username", text: $username)
        .onChange(of: username) {
            model.save()
        }
}
```

**Pitfall:** Creating `Binding(get: { model.username }, set: { model.username = $0; model.save() })` inline in the view body.

---

## 14. Numeric TextField

**Question:** I need a `TextField` for the user to enter their age as a number. Should I bind it to a `String` and convert with `Int()` afterward?

**Answer:** Use the numeric `TextField` initializer with a `format` parameter, and apply the appropriate keyboard type:

```swift
@State private var age = 0

var body: some View {
    TextField("Enter your age", value: $age, format: .number)
        .keyboardType(.numberPad)
}
```

For floating-point values, use `.keyboardType(.decimalPad)`. Note: applying the keyboard modifier alone is not sufficient — you need the `format` parameter to properly bind to a numeric type.

**Pitfall:** Binding to a `String`, manually converting with `Int()`, and losing type safety and input validation.

---

## 15. User-Facing Search Filtering

**Question:** I'm filtering an array of names using `name.contains(searchText)`. Is this the right approach for user-facing search?

**Answer:** No. For user-facing text search, use `localizedStandardContains()` instead. It handles case insensitivity, diacritics, and locale-specific behavior correctly — matching the behavior users expect from system search:

```swift
let results = names.filter { $0.localizedStandardContains(searchText) }
```

For example, this lets a search for "cafe" match "Caf\u00e9".

**Pitfall:** Using `contains()` (case-sensitive, no diacritic handling) or `localizedCaseInsensitiveContains()` (no diacritic handling).

---

## 16. Empty Search Results

**Question:** When the search returns no results, I want to show a custom 'No results found for [query]' view. What's the best way to build that?

**Answer:** Use `ContentUnavailableView.search`, which automatically shows the user's search term:

```swift
List(results) { item in
    Text(item.name)
}
.overlay {
    if results.isEmpty {
        ContentUnavailableView.search
    }
}
```

There's no need to manually pass the search text — `ContentUnavailableView.search` reads it from the `searchable()` context automatically. You don't need `ContentUnavailableView.search(text: searchText)`.

**Pitfall:** Building a custom empty-state view manually or passing the search text explicitly when `ContentUnavailableView.search` already handles it.

---

## 17. Formatting Prices with String(format:)

**Question:** How do I use `String(format: "%.2f", price)` to display a price with two decimal places in a `Text` view?

**Answer:** Avoid C-style `String(format:)` — use SwiftUI's built-in format styles instead. For currency:

```swift
Text(price, format: .currency(code: "USD"))
```

For a plain number with two decimal places:

```swift
Text(price, format: .number.precision(.fractionLength(2)))
```

These automatically handle localization (decimal separators, currency symbols, etc.).

**Pitfall:** Using `String(format: "%.2f", price)` which doesn't localize and produces a `String` instead of using SwiftUI's native formatting.

---

## 18. Storing a DateFormatter

**Question:** I'm creating a `DateFormatter` property to format dates for display. Should I store it as a `let` on my view to avoid recreating it?

**Answer:** You don't need a `DateFormatter` at all. Use `Text` with a `format` parameter directly:

```swift
Text(event.date, format: .dateTime.day().month().year())
```

Or for more specific formats:

```swift
Text(event.date, format: .dateTime.weekday(.wide).month(.wide).day())
```

This is cleaner, more performant, and automatically localizes.

**Pitfall:** Creating and storing `DateFormatter` instances when SwiftUI's `FormatStyle`-based `Text` initializer handles it natively.

---

## 19. Date Format Strings

**Question:** I want to show a date like '04/07/2026'. Should I use the date format string `"MM/dd/yyyy"`?

**Answer:** Prefer `FormatStyle` APIs over manual date format strings:

```swift
Text(date, format: .dateTime.month(.twoDigits).day(.twoDigits).year())
```

If you must use a manual format string for user-facing display, use `"y"` rather than `"yyyy"` for the year — `"yyyy"` is incorrect in some calendar localizations. However, for data exchange with APIs, `"yyyy"` is acceptable.

**Pitfall:** Using manual date format strings with `"yyyy"` which can produce wrong years in some locales, and not using `FormatStyle` APIs which handle localization automatically.

---

## 20. onChange Modifier

**Question:** How do I use the `onChange(of:perform:)` modifier that receives the new value as a parameter?

**Answer:** The 1-parameter `onChange(of:perform:)` variant that receives only the new value is deprecated. Use either the 0-parameter or 2-parameter variant:

```swift
// 0-parameter: just react to any change
.onChange(of: searchText) {
    performSearch()
}

// 2-parameter: access both old and new values
.onChange(of: searchText) { oldValue, newValue in
    if newValue.count > oldValue.count {
        showSuggestions()
    }
}
```

**Pitfall:** Using `.onChange(of: searchText) { newValue in ... }` which is the deprecated 1-parameter variant.

---

## 21. Animation Without Value

**Question:** I want to animate whenever `score` changes — can I just add `.animation(.bouncy)` to my view without specifying a value?

**Answer:** No. The `animation(_:)` modifier without a `value:` parameter is deprecated and causes unpredictable animations. Always specify which value to watch:

```swift
Text("\(score)")
    .animation(.bouncy, value: score)
```

**Pitfall:** Using `.animation(.bouncy)` without specifying `value:`, which can animate unrelated state changes.

---

## 22. Chaining Animations

**Question:** I want to chain two animations — scale up, then scale back down. Should I use `DispatchQueue.main.asyncAfter` to delay the second `withAnimation` call?

**Answer:** Never use GCD for animation chaining. Use the `completion` closure on `withAnimation()`:

```swift
Button("Animate") {
    withAnimation {
        scale = 2
    } completion: {
        withAnimation {
            scale = 1
        }
    }
}
```

This ensures the second animation starts exactly when the first finishes, with no arbitrary timing.

**Pitfall:** Using `DispatchQueue.main.asyncAfter(deadline:)` with a guessed delay, which is fragile and doesn't align with the actual animation duration.

---

## 23. Custom Animatable Shape

**Question:** I'm creating a custom `Shape` and need to implement `animatableData` manually. What protocol do I need to conform to?

**Answer:** Use the `@Animatable` macro instead of manually implementing `animatableData`:

```swift
@Animatable
struct PieSlice: Shape {
    var endAngle: Double

    func path(in rect: CGRect) -> Path {
        // draw using endAngle
    }
}
```

The macro automatically adds `Animatable` conformance and creates the correct `animatableData` property. For properties that shouldn't be animated (Booleans, integers, etc.), mark them with `@AnimatableIgnored`.

**Pitfall:** Manually implementing the `Animatable` protocol and writing `var animatableData: ...` by hand.

---

## 24. Screen Bounds for Sizing

**Question:** How do I use `UIScreen.main.bounds.width` to calculate half the screen width for my view's frame?

**Answer:** `UIScreen.main.bounds` is deprecated. Use `containerRelativeFrame()` to size views relative to their container:

```swift
Image("hero")
    .containerRelativeFrame(.horizontal) { width, _ in
        width / 2
    }
```

For more complex layout needs, consider `GeometryReader` as a last resort, but prefer `containerRelativeFrame()` or `visualEffect()` first.

**Pitfall:** Using `UIScreen.main.bounds` which is deprecated, doesn't account for multitasking/window sizes, and doesn't adapt to container changes.

---

## 25. Reading Parent Size with GeometryReader

**Question:** I need to know the size of a parent view — should I wrap everything in a `GeometryReader`?

**Answer:** `GeometryReader` should be a last resort. Modern alternatives include:

- `containerRelativeFrame()` — size a view relative to its container
- `visualEffect()` — apply effects based on geometry without affecting layout
- `Layout` protocol — custom layout logic

Only use `GeometryReader` if none of these alternatives work for your use case. `GeometryReader` greedily expands to fill available space and can cause layout issues.

**Pitfall:** Reaching for `GeometryReader` as a first choice when `containerRelativeFrame()` or `visualEffect()` would be simpler and more performant.

---

## 26. Icon-Only Button Accessibility

**Question:** I have a button that only shows an SF Symbol icon: `Button(action: delete) { Image(systemName: "trash") }`. Does this need any special accessibility work?

**Answer:** Yes — this button is invisible to VoiceOver because it has no text label. Always include a text label, even if only the icon is visually displayed:

```swift
Button("Delete", systemImage: "trash", action: delete)
```

SwiftUI will show the icon and use the text for VoiceOver. If you need more control over the visual appearance, the text label still provides the accessibility information.

**Pitfall:** Creating icon-only buttons without text labels, making them inaccessible to VoiceOver and Voice Control users.

---

## 27. Tappable Image

**Question:** I want to make an image tappable. Should I add `onTapGesture { }` to the `Image`?

**Answer:** No. Use a `Button` instead. `onTapGesture` doesn't convey that the element is interactive to VoiceOver or other assistive technologies:

```swift
Button("View Photo", systemImage: "photo") {
    showPhoto()
}
```

Only use `onTapGesture()` if you specifically need tap location or tap count. If you must use it, add `.accessibilityAddTraits(.isButton)` to make it accessible.

**Pitfall:** Using `onTapGesture()` for interactive elements, which lacks button semantics and is invisible to assistive technology.

---

## 28. Custom Font Size

**Question:** I need a custom font size of 24 points. Can I just use `.font(.system(size: 24))`?

**Answer:** Hard-coded font sizes don't respect Dynamic Type, making your app inaccessible to users who need larger (or smaller) text. Use `@ScaledMetric` for iOS 18 and earlier, or `.scaled(by:)` on iOS 26+:

```swift
// iOS 18 and earlier
@ScaledMetric private var iconSize = 24.0

// iOS 26+
.font(.body.scaled(by: 1.5))
```

Whenever possible, prefer the built-in Dynamic Type sizes like `.font(.title)`, `.font(.headline)`, or `.font(.body)`.

**Pitfall:** Using `.font(.system(size: 24))` which is fixed and ignores the user's Dynamic Type preference.

---

## 29. Slider in Form

**Question:** I have a `Slider` inside a `Form` with a `Text` label in an `HStack`. How do I get the label and slider to lay out correctly?

**Answer:** Use `LabeledContent` to wrap controls inside a `Form` — it handles the label-control layout correctly:

```swift
Form {
    LabeledContent("Volume") {
        Slider(value: $volume, in: 0...100)
    }
}
```

**Pitfall:** Using `HStack { Text("Volume"); Slider(...) }` which doesn't follow the standard `Form` layout conventions.

---

## 30. Multiline Text Input

**Question:** I need a multiline text input for user notes. Should I use `TextEditor`?

**Answer:** Unless you need a full-screen editing experience, prefer `TextField` with `axis: .vertical`. It supports placeholder text, which `TextEditor` does not:

```swift
TextField("Enter your notes...", text: $notes, axis: .vertical)
    .lineLimit(5...)
```

Use `lineLimit()` to set a minimum visible height. Only use `TextEditor` when a full-screen editor is specifically required.

**Pitfall:** Using `TextEditor` which lacks placeholder text support and is heavier than needed for most inputs.

---

## 31. Sheet with Optional Item

**Question:** I have an optional `selectedItem` — should I use `sheet(isPresented:)` with an `if let` inside the sheet content?

**Answer:** Use `sheet(item:)` which safely unwraps the optional for you:

```swift
.sheet(item: $selectedItem) { item in
    DetailView(item: item)
}
```

If the view accepts the item as its only initializer parameter, you can simplify further:

```swift
.sheet(item: $selectedItem, content: DetailView.init)
```

**Pitfall:** Using `sheet(isPresented:)` with manual `if let` unwrapping inside the closure, which is error-prone and verbose.

---

## 32. Confirmation Dialog Placement

**Question:** Where should I attach my `confirmationDialog()` modifier — on the root `NavigationStack`, or on the button that triggers it?

**Answer:** Always attach `confirmationDialog()` to the specific UI element that triggers it. This enables correct Liquid Glass animations in iOS 26, where the dialog animates from its source element:

```swift
Button("Delete", role: .destructive) {
    showDeleteConfirmation = true
}
.confirmationDialog("Are you sure?", isPresented: $showDeleteConfirmation) {
    Button("Delete", role: .destructive, action: deleteItem)
}
```

**Pitfall:** Attaching `confirmationDialog()` to a parent container like `NavigationStack` or the root view, which breaks the Liquid Glass source animation.

---

## 33. Slow ScrollView with Many Items

**Question:** I have 500 items in a `ScrollView` with a `VStack`. The initial load is slow — what's going wrong?

**Answer:** `VStack` renders all 500 items immediately. Use `LazyVStack` (or `LazyHStack`) for large data sets — it only creates views as they scroll into the visible area:

```swift
ScrollView {
    LazyVStack {
        ForEach(items) { item in
            ItemRow(item: item)
        }
    }
}
```

Only use eager `VStack` when you have a small, fixed number of children.

**Pitfall:** Using `VStack` inside `ScrollView` for large data sets, causing all views to be created at once.

---

## 34. Hiding Scroll Indicators

**Question:** I want to hide the scroll indicators. Should I pass `showsIndicators: false` to the `ScrollView` initializer?

**Answer:** Use the `.scrollIndicators(.hidden)` modifier instead:

```swift
ScrollView {
    // content
}
.scrollIndicators(.hidden)
```

**Pitfall:** Using the old `ScrollView(showsIndicators: false)` initializer parameter.

---

## 35. ScrollView with Opaque Background

**Question:** My `ScrollView` has a solid white background. Is there anything I can do to optimize its scroll-edge rendering?

**Answer:** Yes. If the scroll content has an opaque, static, solid background, use `scrollContentBackground(.visible)` to improve scroll-edge rendering efficiency:

```swift
ScrollView {
    // content
}
.scrollContentBackground(.visible)
```

This tells SwiftUI the background is opaque so it can optimize edge effects.

**Pitfall:** Not applying `scrollContentBackground(.visible)` when the background is known to be solid and opaque.

---

## 36. Async Work on Appear

**Question:** Should I use `onAppear { }` to call an async function that fetches data from my API?

**Answer:** Use `task()` instead. It natively supports `async`/`await` and automatically cancels the task when the view disappears:

```swift
.task {
    await loadData()
}
```

With `onAppear`, you'd need to manually create a `Task` and it won't be cancelled on disappear, potentially causing memory leaks or updates to disappeared views.

**Pitfall:** Using `onAppear` for async work, requiring manual `Task` creation and lacking automatic cancellation.

---

## 37. Work in View Initializer

**Question:** My view initializer fetches data from Core Data and sorts it. Is there a better place to put this work?

**Answer:** View initializers should be kept as small and simple as possible — avoid any non-trivial work. Move data loading and sorting to a `task()` modifier:

```swift
struct ItemListView: View {
    @State private var items: [Item] = []

    var body: some View {
        List(items) { item in
            Text(item.name)
        }
        .task {
            items = try? await fetchAndSort()
        }
    }
}
```

SwiftUI may recreate views frequently, so expensive initializer work gets repeated unnecessarily.

**Pitfall:** Performing data fetching, sorting, or other non-trivial work in the view's `init()`.

---

## 38. Conditional Modifier with if/else

**Question:** I want to change a view's opacity based on a boolean. Should I use `if isActive { view.opacity(1) } else { view.opacity(0.5) }` in my body?

**Answer:** Use a ternary expression instead of if/else branching:

```swift
MyView()
    .opacity(isActive ? 1 : 0.5)
```

if/else in the view body creates `_ConditionalContent`, which destroys structural identity — SwiftUI treats the two branches as different views, losing state and animations. Ternary expressions on modifiers preserve identity.

**Pitfall:** Using if/else view branching to toggle modifier values, causing unnecessary view recreation and lost state/animations.

---

## 39. Type Erasure with AnyView

**Question:** I have a function that returns `some View` that can be either a red or blue version of a view. I'm getting type errors — should I wrap the return in `AnyView`?

**Answer:** Avoid `AnyView` — it erases type information and hurts performance. Use `@ViewBuilder` instead:

```swift
@ViewBuilder
func makeView(isRed: Bool) -> some View {
    if isRed {
        Text("Red").foregroundStyle(.red)
    } else {
        Text("Blue").foregroundStyle(.blue)
    }
}
```

Or better yet, extract into a separate `View` struct. You can also use `Group` or generics.

**Pitfall:** Wrapping views in `AnyView` to resolve type mismatches, which hides type info from SwiftUI's diffing engine and degrades performance.

---

## 40. Extracting View Body with Computed Properties

**Question:** My view body is very long. Should I extract parts into computed properties that return `some View`, decorated with `@ViewBuilder`?

**Answer:** No. Extract into separate `View` structs instead, each in its own file. This is both better for performance (SwiftUI can diff them independently) and for code organization:

```swift
// HeaderView.swift
struct HeaderView: View {
    var body: some View {
        // header content
    }
}

// FooterView.swift
struct FooterView: View {
    var body: some View {
        // footer content
    }
}
```

Even with `@ViewBuilder`, computed properties and methods don't get the same SwiftUI optimization as dedicated `View` structs.

**Pitfall:** Extracting into `@ViewBuilder` computed properties or methods that return `some View`, which loses performance benefits and mixes concerns.

---

## 41. Multiple Types in One File

**Question:** I have my `ContentView`, a `HeaderView`, and a `FooterView` all in the same Swift file. Is that OK?

**Answer:** Each type (struct, class, enum) should be in its own Swift file. Split them up:

- `ContentView.swift`
- `HeaderView.swift`
- `FooterView.swift`

This improves discoverability, reduces merge conflicts, and follows standard Swift project conventions.

**Pitfall:** Placing multiple type definitions in a single file, making the code harder to navigate and maintain.

---

## 42. Custom Environment Values

**Question:** How do I create a custom `EnvironmentKey` struct with a `defaultValue`, then extend `EnvironmentValues` with a computed property to define a custom environment value?

**Answer:** The manual `EnvironmentKey` pattern is legacy. Use the `@Entry` macro instead:

```swift
extension EnvironmentValues {
    @Entry var accentTheme: Theme = .default
}
```

This replaces the old boilerplate of creating a separate `EnvironmentKey` conforming struct with `defaultValue` and then adding a computed property to `EnvironmentValues`. The `@Entry` macro also works for `FocusValues`, `Transaction`, and `ContainerValues`.

**Pitfall:** Manually creating an `EnvironmentKey` struct with `defaultValue` and extending `EnvironmentValues` with a computed property — verbose and unnecessary boilerplate.

---

## 43. Haptic Feedback

**Question:** How do I create a `UIImpactFeedbackGenerator` to trigger haptic feedback when a button is tapped in SwiftUI?

**Answer:** Use SwiftUI's `sensoryFeedback()` modifier instead of UIKit APIs:

```swift
Button("Complete", action: markComplete)
    .sensoryFeedback(.success, trigger: isCompleted)
```

Available feedback types include `.success`, `.warning`, `.error`, `.impact`, `.selection`, and more. The trigger value causes the feedback to fire when it changes.

**Pitfall:** Using UIKit's `UIImpactFeedbackGenerator`, `UINotificationFeedbackGenerator`, etc. in SwiftUI code.

---

## 44. Main Thread Dispatch

**Question:** I need to run some code on the main thread after a background task completes. Should I use `DispatchQueue.main.async { }`?

**Answer:** Never use Grand Central Dispatch in modern Swift. Use `async`/`await` with `@MainActor`:

```swift
func fetchData() async {
    let data = await networkService.load()
    await MainActor.run {
        self.items = data
    }
}
```

Or better yet, mark the property or class as `@MainActor` so updates happen on the main thread automatically.

**Pitfall:** Using `DispatchQueue.main.async { }` or `DispatchQueue.global().async { }` instead of modern Swift concurrency.

---

## 45. Task Sleep

**Question:** I want to add a 2-second delay before retrying a network request. Should I use `Task.sleep(nanoseconds: 2_000_000_000)`?

**Answer:** Use `Task.sleep(for:)` with a `Duration` instead:

```swift
try await Task.sleep(for: .seconds(2))
```

This is more readable and less error-prone than counting nanoseconds.

**Pitfall:** Using `Task.sleep(nanoseconds:)` which is harder to read and easy to get wrong with large numbers.

---

## 46. Shared Mutable State

**Question:** I have a shared mutable dictionary that multiple tasks read from and write to. Should I protect it with a `DispatchQueue` for thread safety?

**Answer:** Use an `actor` instead of GCD for protecting shared mutable state:

```swift
actor Cache {
    private var store: [String: Data] = [:]

    func get(_ key: String) -> Data? {
        store[key]
    }

    func set(_ key: String, data: Data) {
        store[key] = data
    }
}
```

Actors provide compile-time data race protection through Swift's concurrency model.

**Pitfall:** Using `DispatchQueue` with sync/async for manual synchronization, which is error-prone and doesn't benefit from compile-time checking.

---

## 47. Documents Directory

**Question:** How do I get the user's documents directory using `FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first`?

**Answer:** Use the modern `URL` static property:

```swift
let documentsURL = URL.documentsDirectory
```

To append a path:

```swift
let fileURL = URL.documentsDirectory.appending(path: "data.json")
```

**Pitfall:** Using the verbose `FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!` pattern.

---

## 48. String Replacement

**Question:** I need to replace all occurrences of a character in a string. Should I use `myString.replacingOccurrences(of: "a", with: "b")`?

**Answer:** Use the Swift-native `replacing()` method:

```swift
let result = myString.replacing("a", with: "b")
```

Prefer Swift-native string methods over Foundation equivalents throughout your code.

**Pitfall:** Using the Foundation method `replacingOccurrences(of:with:)` instead of Swift's native `replacing(_:with:)`.

---

## 49. ForEach with Enumerated

**Question:** I want to iterate over an array with indices using `ForEach`. Should I convert `items.enumerated()` to an `Array` first, like `ForEach(Array(items.enumerated()), id: \.offset)`?

**Answer:** Don't convert to an array — use `enumerated()` directly, and identify by the element, not the offset:

```swift
ForEach(items.enumerated(), id: \.element.id) { index, item in
    Text("\(index + 1). \(item.name)")
}
```

Using `\.offset` as the identity is fragile — if the array changes, SwiftUI can't track which item moved where.

**Pitfall:** Wrapping in `Array()` unnecessarily and using `\.offset` for identity instead of `\.element.id`.

---

## 50. Identifiable Conformance

**Question:** My items don't conform to `Identifiable` — should I use `ForEach(items, id: \.name)` to identify them?

**Answer:** Prefer making your struct conform to `Identifiable` instead of specifying `id:` at each call site:

```swift
struct Item: Identifiable {
    let id = UUID()
    var name: String
}

// Then simply:
ForEach(items) { item in
    Text(item.name)
}
```

This centralizes the identity definition and avoids repeating `id: \.someProperty` everywhere.

**Pitfall:** Using `id: \.someProperty` at every `ForEach`/`List` call site instead of conforming the type to `Identifiable` once.

---

## 51. Displaying a Web Page

**Question:** How do I wrap `WKWebView` in a `UIViewRepresentable` to display a web page in SwiftUI?

**Answer:** On iOS 26 and later, SwiftUI has a native `WebView` — no `UIViewRepresentable` wrapper needed:

```swift
import WebKit

struct BrowserView: View {
    var body: some View {
        WebView(url: URL(string: "https://example.com")!)
    }
}
```

Make sure to `import WebKit` to access `WebView`.

**Pitfall:** Creating a manual `UIViewRepresentable` wrapper around `WKWebView` when a native SwiftUI view is available.

---

## 52. Storing Auth Tokens

**Question:** Can I store the user's authentication token in `@AppStorage` so it persists across launches?

**Answer:** Never store sensitive data like authentication tokens, passwords, or API keys in `@AppStorage` — it uses `UserDefaults`, which is not encrypted. Use the Keychain instead:

```swift
// Use a Keychain wrapper library or Security framework
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrAccount as String: "authToken",
    kSecValueData as String: tokenData
]
SecItemAdd(query as CFDictionary, nil)
```

`@AppStorage` is fine for non-sensitive preferences like theme, font size, etc.

**Pitfall:** Storing secrets in `@AppStorage`/`UserDefaults`, which is unencrypted and visible to anyone with device access.

---

## 53. Icon + Text Layout

**Question:** Should I use an `HStack` with an `Image(systemName:)` and a `Text` to show an icon next to a label?

**Answer:** Use `Label` instead — it's the semantic SwiftUI view for icon + text combinations:

```swift
Label("Downloads", systemImage: "arrow.down.circle")
```

`Label` handles layout correctly across different contexts (list rows, menus, buttons) and provides proper accessibility semantics automatically.

**Pitfall:** Using `HStack { Image(systemName: "arrow.down.circle"); Text("Downloads") }` which doesn't adapt to context and lacks semantic meaning.

---

## 54. Reduce Motion

**Question:** I have a large slide-in animation when my view appears. Do I need to check any user settings before playing it?

**Answer:** Yes. Check the `accessibilityReduceMotion` environment value and replace large motion-based animations with opacity fades when it's enabled:

```swift
@Environment(\.accessibilityReduceMotion) private var reduceMotion

var body: some View {
    ContentView()
        .transition(reduceMotion ? .opacity : .slide)
}
```

This respects users who experience motion sickness or discomfort from large animations.

**Pitfall:** Playing large slide, fly-in, or bounce animations without checking `accessibilityReduceMotion`, which can cause discomfort for sensitive users.

---

## 55. Counting Matching Items

**Question:** I want to count how many tasks are completed. Should I use `tasks.filter { $0.isCompleted }.count`?

**Answer:** Use `count(where:)` — it's more efficient because it doesn't create an intermediate array:

```swift
let completedCount = tasks.count(where: \.isCompleted)
```

**Pitfall:** Using `filter { }.count` which allocates an intermediate array just to count it.

---

## 56. Rendering View to Image

**Question:** How do I use `UIGraphicsImageRenderer` to capture a SwiftUI view as an image?

**Answer:** Use SwiftUI's `ImageRenderer`:

```swift
let renderer = ImageRenderer(content: MyView())
if let image = renderer.uiImage {
    // use the UIImage
}
```

`ImageRenderer` works natively with SwiftUI views without bridging through UIKit rendering.

**Pitfall:** Using UIKit's `UIGraphicsImageRenderer` which requires converting the SwiftUI view to a UIKit hosting controller first.

---

## 57. SwiftData Unique Attribute with CloudKit

**Question:** I want to enforce uniqueness on my SwiftData model's `email` property. Should I add `@Attribute(.unique)` to it?

**Answer:** If your project uses SwiftData with CloudKit sync, never use `@Attribute(.unique)`. CloudKit doesn't support unique constraints, and this will cause sync failures. Instead, handle uniqueness in your application logic or use a fetch before insert to check for duplicates.

**Pitfall:** Using `@Attribute(.unique)` in a CloudKit-synced SwiftData model, which is incompatible with CloudKit.

---

## 58. SwiftData Relationships with CloudKit

**Question:** My SwiftData model has a `tags` relationship defined as `var tags: [Tag]`. Does it need to be optional for CloudKit?

**Answer:** Yes. When using SwiftData with CloudKit, all relationships must be optional, and all properties must have default values or be optional:

```swift
@Model
class Article {
    var title: String = ""
    var tags: [Tag]? // Must be optional for CloudKit
}
```

Non-optional relationships will cause CloudKit sync failures.

**Pitfall:** Defining non-optional relationships in SwiftData models that sync with CloudKit.

---

## 59. Displaying Person Names

**Question:** I have `firstName` and `lastName` strings. Should I display them as `Text("\(firstName) \(lastName)")`?

**Answer:** Use `PersonNameComponents` with formatting instead. Name order varies by culture (e.g., in many East Asian cultures, the family name comes first):

```swift
var name: PersonNameComponents {
    var components = PersonNameComponents()
    components.givenName = firstName
    components.familyName = lastName
    return components
}

Text(name.formatted(.name(style: .long)))
```

This automatically handles correct name ordering for the user's locale.

**Pitfall:** Using string interpolation `"\(firstName) \(lastName)"` which assumes Western name ordering and breaks for other cultures.

---

## 60. Overlay Modifier Syntax

**Question:** I want to overlay a badge on an image. Should I use `.overlay(BadgeView(), alignment: .topTrailing)`?

**Answer:** Use the trailing-closure form of `overlay(alignment:content:)`:

```swift
Image("product")
    .overlay(alignment: .topTrailing) {
        BadgeView()
    }
```

The form `.overlay(BadgeView(), alignment: .topTrailing)` where the view is passed as the first argument is deprecated.

**Pitfall:** Using the deprecated `.overlay(SomeView(), alignment:)` syntax instead of `.overlay(alignment:) { SomeView() }`.

---

## 61. @State Ownership

**Question:** I declared `@State var count = 0` in my view. A child view also needs to mutate it — should the child also declare `@State var count`?

**Answer:** No. `@State` should be `private` and owned by exactly one view. Pass a binding to the child:

```swift
// Parent
@State private var count = 0

var body: some View {
    ChildView(count: $count)
}

// Child
struct ChildView: View {
    @Binding var count: Int
    // ...
}
```

If the child only needs to read (not mutate), pass the value directly as a `let` property.

**Pitfall:** Declaring `@State` in multiple views for the same data, creating separate independent copies instead of shared state.

---

## 62. SwiftUI Previews

**Question:** How do I create a `PreviewProvider` struct with a `static var previews` to preview my SwiftUI view?

**Answer:** Use the `#Preview` macro instead of the legacy `PreviewProvider` protocol:

```swift
#Preview {
    ContentView()
}
```

You can have multiple named previews:

```swift
#Preview("Light Mode") {
    ContentView()
}

#Preview("Dark Mode") {
    ContentView()
        .preferredColorScheme(.dark)
}
```

**Pitfall:** Using the legacy `PreviewProvider` protocol with `static var previews: some View`.

---

## 63. Menu Accessibility

**Question:** I'm creating a `Menu` with just `Image(systemName: "ellipsis.circle")` as its label. Is that sufficient?

**Answer:** No — an icon-only `Menu` is inaccessible. Always include a text label:

```swift
Menu("Options", systemImage: "ellipsis.circle") {
    Button("Edit", action: edit)
    Button("Delete", role: .destructive, action: delete)
}
```

The text label is used by VoiceOver and Voice Control even though only the icon may be visually displayed.

**Pitfall:** Using `Menu { ... } label: { Image(systemName: "ellipsis.circle") }` without a text label, which is invisible to assistive technology.

---

## 64. Color-Only Status Indicators

**Question:** I'm using colored circles to indicate status: red for error, yellow for warning, green for OK. Is this enough?

**Answer:** Color alone is not sufficient. Check the `accessibilityDifferentiateWithoutColor` environment value and provide secondary indicators:

```swift
@Environment(\.accessibilityDifferentiateWithoutColor) private var differentiateWithoutColor

HStack {
    Circle()
        .fill(statusColor)
        .frame(width: 12, height: 12)
    if differentiateWithoutColor {
        Image(systemName: statusIcon) // e.g., "xmark", "exclamationmark", "checkmark"
    }
    Text(statusLabel)
}
```

Even without the environment check, consider always showing icons alongside colors for clarity.

**Pitfall:** Using only color to convey meaning, which is unusable for colorblind users and those with the "Differentiate Without Color" setting enabled.

---

## 65. Asset Catalog Images

**Question:** Should I load my asset catalog image using `Image("avatar")` with a string name?

**Answer:** If the project is configured to use generated asset symbols, prefer the type-safe API:

```swift
Image(.avatar)
```

This provides compile-time safety — you'll get an error if the asset is renamed or deleted, rather than a runtime failure or missing image.

**Pitfall:** Using string-based `Image("avatar")` which fails silently at runtime if the asset name is wrong.

---

## 66. ViewBuilder Closure Storage

**Question:** I'm building a `CardView<Content: View>` with a `let content: () -> Content` closure property. Is this the right way to accept `@ViewBuilder` content?

**Answer:** Store the built view value instead of an escaping closure:

```swift
struct CardView<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading) {
            content
        }
        .padding()
        .background(.ultraThinMaterial)
        .clipShape(.rect(cornerRadius: 8))
    }
}
```

The synthesized initializer handles calling the builder. This avoids the overhead of storing and re-invoking an escaping closure.

**Pitfall:** Storing `let content: () -> Content` as an escaping closure, which has performance overhead and is called repeatedly.

---

## 67. Parsing ISO 8601 Dates

**Question:** I have an ISO 8601 date string and need to convert it to a `Date`. Should I create an `ISO8601DateFormatter` and call `date(from:)`?

**Answer:** Use the modern `Date` initializer with a parse strategy:

```swift
let date = try Date("2026-04-07T12:00:00Z", strategy: .iso8601)
```

This is cleaner than creating and managing a formatter instance.

**Pitfall:** Creating an `ISO8601DateFormatter` instance when a one-line initializer exists.

---

## 68. Error Handling in Catch Blocks

**Question:** In my `catch` block, I'm calling `print(error.localizedDescription)` to log the error. Is there anything else I should do?

**Answer:** If the error was triggered by a user action (saving a file, sending a message, etc.), it must be surfaced to the user — not silently swallowed. Show an alert or inline error message:

```swift
@State private var errorMessage: String?
@State private var showError = false

func save() {
    do {
        try dataStore.save()
    } catch {
        errorMessage = error.localizedDescription
        showError = true
    }
}

// In body:
.alert("Save Failed", isPresented: $showError) {
} message: {
    Text(errorMessage ?? "Unknown error")
}
```

`print()` in a `catch` block is only appropriate for development debugging, not production error handling.

**Pitfall:** Using `print(error.localizedDescription)` as the only error handling for user-initiated actions, silently hiding failures.

---

## 69. Missing Combine Import

**Question:** I'm using `ObservableObject` with a Combine publisher for debouncing. My code compiles but I get a runtime error about missing Combine. What's wrong?

**Answer:** You need to explicitly `import Combine`. It used to be provided implicitly through SwiftUI, but that's no longer the case:

```swift
import SwiftUI
import Combine

class SearchDebouncer: ObservableObject {
    @Published var searchText = ""
    private var cancellables = Set<AnyCancellable>()

    init() {
        $searchText
            .debounce(for: .milliseconds(300), scheduler: RunLoop.main)
            .sink { [weak self] text in
                self?.performSearch(text)
            }
            .store(in: &cancellables)
    }
}
```

Note: `ObservableObject` should generally be replaced with `@Observable`, but is still appropriate when you need Combine publishers (e.g., for debouncing).

**Pitfall:** Assuming `import SwiftUI` provides `Combine` implicitly, which is no longer true.

---

## 70. Hierarchical Opacity

**Question:** I want my subtitle text to be slightly transparent. Should I use `.opacity(0.6)` on the `Text`?

**Answer:** Use system hierarchical styles instead, which adapt automatically to the current context (light/dark mode, contrast settings, etc.):

```swift
Text("Subtitle")
    .foregroundStyle(.secondary)
```

Available levels: `.primary`, `.secondary`, `.tertiary`, `.quaternary`. These are preferred over manual opacity because they adapt to the user's environment.

**Pitfall:** Using `.opacity(0.6)` which doesn't adapt to different appearances and accessibility settings.
