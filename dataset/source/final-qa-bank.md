# Final QA Bank — SwiftUI Docs Chatbot Benchmark

75 questions for benchmarking an AI search agent. Questions are written to require **semantic understanding** rather than keyword matching. Each entry includes the correct modern answer targeting iOS 26 / Swift 6.2.

---

## Q1. Tab Definition
**Question:** I'm building a tab bar and want to give each tab an icon and title. What's the modern way to define tabs in a TabView?

**Answer:** The `tabItem()` modifier is deprecated. Use the `Tab` view API instead:

```swift
TabView {
    Tab("Home", systemImage: "house") {
        HomeView()
    }
    Tab("Search", systemImage: "magnifyingglass") {
        SearchView()
    }
}
```

**Pitfall:** Using the deprecated `tabItem()` modifier.

---

## Q2. Programmatic Tab Selection
**Question:** I need to programmatically switch tabs in my app. I'm thinking of using integers to track which tab is selected — is that the standard approach?

**Answer:** Use a type-safe enum instead of integers:

```swift
enum AppTab { case home, search, profile }
@State private var selectedTab = AppTab.home

TabView(selection: $selectedTab) {
    Tab("Home", systemImage: "house", value: .home) { HomeView() }
    Tab("Search", systemImage: "magnifyingglass", value: .search) { SearchView() }
}
```

**Pitfall:** Using `Int` or `String` for tab selection, which is fragile and unclear.

---

## Q3. Hierarchical Navigation Setup
**Question:** I'm setting up hierarchical navigation where tapping a list row pushes a detail screen. What's the recommended container and link pattern?

**Answer:** Use `NavigationStack` with value-based `NavigationLink` and `navigationDestination(for:)`:

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

`NavigationView` is deprecated. Do not mix `NavigationLink(destination:)` and `navigationDestination(for:)`.

**Pitfall:** Using `NavigationView` with `NavigationLink(destination:)`.

---

## Q4. Toolbar Button in Top-Right Corner
**Question:** I want to place an Edit button in the top-right corner of my navigation bar. What placement value should I use in a ToolbarItem?

**Answer:** Use `.topBarTrailing`:

```swift
.toolbar {
    ToolbarItem(placement: .topBarTrailing) {
        Button("Edit", action: editAction)
    }
}
```

**Pitfall:** Using the deprecated `.navigationBarLeading` and `.navigationBarTrailing` placements.

---

## Q5. Styling Text with a Custom Color
**Question:** I'm styling text with a custom color from my asset catalog. There seem to be multiple options for setting text color in SwiftUI — which modifier should I use?

**Answer:** Use `foregroundStyle()`, which works with any `ShapeStyle` including colors, gradients, and hierarchical styles:

```swift
Text("Hello")
    .foregroundStyle(.red)

Text("Custom")
    .foregroundStyle(Color("BrandBlue"))
```

**Pitfall:** Using the deprecated `foregroundColor()` modifier.

---

## Q6. Differently-Styled Text on One Line
**Question:** I need to display "Hello" in red and "World" in blue on the same line as a single text element. How do I compose differently-styled text fragments?

**Answer:** Use text interpolation with individually styled `Text` values:

```swift
var body: some View {
    let hello = Text("Hello").foregroundStyle(.red)
    let world = Text("World").foregroundStyle(.blue)
    Text("\(hello) \(world)")
}
```

**Pitfall:** Using `Text` concatenation with `+`, which is deprecated.

---

## Q7. Rounding Corners on a Container
**Question:** I need to round the corners of a VStack that has a background. What's the correct way to clip a view to rounded corners?

**Answer:** Use `clipShape()` with a rounded rectangle:

```swift
VStack { /* content */ }
    .clipShape(.rect(cornerRadius: 12))
```

**Pitfall:** Using the deprecated `cornerRadius()` modifier.

---

## Q8. Adding a Border to a Filled Shape
**Question:** I want to add a stroke border around a `RoundedRectangle` — should I use an `.overlay` with a stroked shape on top?

**Answer:** Since iOS 17, you can chain `.fill()` and `.stroke()` directly on a shape:

```swift
RoundedRectangle(cornerRadius: 12)
    .fill(.blue)
    .stroke(.white, lineWidth: 2)
```

**Pitfall:** Using an `.overlay` with a separate stroked shape, which was required before iOS 17.

---

## Q9. Smooth Apple-Style Rounded Corners
**Question:** I want smooth, Apple-style rounded corners on my card shapes. Do I need to pass a corner style parameter to get the continuous rounding effect?

**Answer:** No. The default corner style for `RoundedRectangle` is already `.continuous`:

```swift
RoundedRectangle(cornerRadius: 12) // .continuous is the default
```

**Pitfall:** Explicitly passing `style: .continuous` when it's already the default.

---

## Q10. Shared Data Model for Multiple Views
**Question:** I'm building a shopping cart that multiple views need to read and write to. What's the modern way to create a shared data model in SwiftUI?

**Answer:** Use the `@Observable` macro. The `ObservableObject`/`@Published`/`@EnvironmentObject` pattern is legacy:

```swift
@Observable
@MainActor
class ShoppingCart {
    var items: [Item] = []
    var total: Double = 0
}

// Owner
@State private var cart = ShoppingCart()
var body: some View {
    ChildView().environment(cart)
}

// Consumer
@Environment(ShoppingCart.self) private var cart
```

**Pitfall:** Using `ObservableObject`, `@Published`, `@StateObject`, `@ObservedObject`, or `@EnvironmentObject`.

---

## Q11. Thread Safety for @Observable Classes
**Question:** I have an `@Observable` class — do I need to annotate it with `@MainActor`?

**Answer:** Yes. `@Observable` classes must be marked `@MainActor` to ensure properties are accessed on the main thread for safe UI updates. Exception: projects using Main Actor default actor isolation (Swift 6 build setting).

```swift
@Observable
@MainActor
class UserSettings {
    var theme: Theme = .system
}
```

**Pitfall:** Omitting `@MainActor`, which can lead to data races and concurrency warnings.

---

## Q12. Persisting UserDefaults in an Observable Class
**Question:** Can I put an `@AppStorage` property inside my `@Observable` class so the view updates when UserDefaults changes?

**Answer:** No. `@AppStorage` inside an `@Observable` class will not trigger view updates. `@AppStorage` is designed for views, not classes. Read from `UserDefaults` directly in the class and use `@AppStorage` in the view layer.

**Pitfall:** Placing `@AppStorage` inside an `@Observable` class and expecting it to drive view refreshes.

---

## Q13. Saving on Every Keystroke
**Question:** Can I create a custom binding inline so I can intercept and save on every keystroke?

**Answer:** Avoid inline `Binding(get:set:)` — it's fragile. Use a standard binding from `@State` with `onChange()`:

```swift
@State private var username = ""

var body: some View {
    TextField("Username", text: $username)
        .onChange(of: username) {
            model.save()
        }
}
```

**Pitfall:** Creating `Binding(get: { model.username }, set: { model.username = $0; model.save() })` inline in the view body. *(Source: gpt54minihigh phrasing)*

---

## Q14. Numeric Input Field
**Question:** I need a `TextField` for the user to enter their age as a number. Should I bind it to a `String` and convert with `Int()` afterward?

**Answer:** Use the numeric `TextField` initializer with a `format` parameter:

```swift
@State private var age = 0

TextField("Enter your age", value: $age, format: .number)
    .keyboardType(.numberPad)
```

**Pitfall:** Binding to a `String`, manually converting, and losing type safety.

---

## Q15. User-Facing Search Text Matching
**Question:** I'm filtering an array of names using `name.contains(searchText)`. Is this the right approach for user-facing search?

**Answer:** No. Use `localizedStandardContains()` for user-facing search — it handles case, diacritics, and locale correctly:

```swift
let results = names.filter { $0.localizedStandardContains(searchText) }
```

This lets "cafe" match "Cafe" and "Caf\u00e9".

**Pitfall:** Using `contains()` which is case-sensitive and doesn't handle diacritics.

---

## Q16. Empty Search State
**Question:** When the search returns no results, I want to show a "No results found" message with the user's query. What's the best way to build that?

**Answer:** Use `ContentUnavailableView.search`, which reads the search term from the `searchable()` context automatically:

```swift
.overlay {
    if results.isEmpty {
        ContentUnavailableView.search
    }
}
```

No need to pass the search text manually.

**Pitfall:** Building a custom empty-state view or passing the search text explicitly.

---

## Q17. Displaying Prices and Currency
**Question:** I need to display a price with proper currency formatting and two decimal places. What's the best approach in SwiftUI?

**Answer:** Use SwiftUI's built-in format styles:

```swift
Text(price, format: .currency(code: "USD"))

// Or for a plain number:
Text(price, format: .number.precision(.fractionLength(2)))
```

These handle localization (decimal separators, currency symbols) automatically.

**Pitfall:** Using `String(format: "%.2f", price)` which doesn't localize.

---

## Q18. Formatting Dates for Display
**Question:** I need to show dates in my app in a user-friendly format. Should I create a date formatter property and store it on my view?

**Answer:** No. Use `Text` with a `format` parameter directly:

```swift
Text(event.date, format: .dateTime.day().month().year())
```

This is cleaner, more performant, and automatically localizes.

**Pitfall:** Creating and managing `DateFormatter` instances when SwiftUI's format-style `Text` initializer handles it natively.

---

## Q19. Locale-Safe Date Display
**Question:** I want to display a date in the user's local format. Is it safe to hardcode a date format string like "MM/dd/yyyy"?

**Answer:** Prefer `FormatStyle` APIs:

```swift
Text(date, format: .dateTime.month(.twoDigits).day(.twoDigits).year())
```

Manual format strings with `"yyyy"` can produce wrong years in some calendar localizations. `FormatStyle` handles localization automatically.

**Pitfall:** Using manual date format strings that don't adapt to user locale.

---

## Q20. Reacting to State Changes
**Question:** I need to run code whenever a search field's value changes. How do I observe state changes in SwiftUI, and what parameters does the change callback receive?

**Answer:** Use `onChange` with either the 0-parameter or 2-parameter variant:

```swift
// 0-parameter: just react
.onChange(of: searchText) {
    performSearch()
}

// 2-parameter: access old and new
.onChange(of: searchText) { oldValue, newValue in
    if newValue.count > oldValue.count { showSuggestions() }
}
```

**Pitfall:** Using `.onChange(of: value) { newValue in ... }` — the 1-parameter variant is deprecated.

---

## Q21. Animating a Specific Value Change
**Question:** I want to animate whenever `score` changes — can I just add `.animation(.bouncy)` to my view without specifying a value?

**Answer:** No. Always specify which value to watch:

```swift
Text("\(score)")
    .animation(.bouncy, value: score)
```

The value-less variant is deprecated and causes unpredictable animations on unrelated state changes.

**Pitfall:** Using `.animation(.bouncy)` without `value:`.

---

## Q22. Chaining Sequential Animations
**Question:** I want to chain two animations — scale up, then scale back down. Should I use a delayed dispatch to time the second animation after the first finishes?

**Answer:** Use the `completion` closure on `withAnimation()`:

```swift
withAnimation {
    scale = 2
} completion: {
    withAnimation {
        scale = 1
    }
}
```

**Pitfall:** Using `DispatchQueue.main.asyncAfter` with a guessed delay, which doesn't align with actual animation duration.

---

## Q23. Making a Custom Shape Animatable
**Question:** I'm creating a custom shape that animates between states. What's the modern way to make a shape's properties animate smoothly?

**Answer:** Use the `@Animatable` macro:

```swift
@Animatable
struct PieSlice: Shape {
    var endAngle: Double

    func path(in rect: CGRect) -> Path { /* draw using endAngle */ }
}
```

Mark non-animatable properties with `@AnimatableIgnored`.

**Pitfall:** Manually implementing the `Animatable` protocol and writing `var animatableData`.

---

## Q24. Sizing a View to Half the Available Width
**Question:** I need to size a view to exactly half the available width. How do I measure the container's dimensions in SwiftUI?

**Answer:** Use `containerRelativeFrame()`:

```swift
Image("hero")
    .containerRelativeFrame(.horizontal) { width, _ in
        width / 2
    }
```

For complex needs, consider `visualEffect()`. Only use `GeometryReader` as a last resort.

**Pitfall:** Using `UIScreen.main.bounds` which is deprecated, doesn't account for multitasking, and doesn't adapt to container changes.

---

## Q25. Reading a Parent View's Size
**Question:** I need to position child elements based on how much space the parent has. What are my options for reading container dimensions?

**Answer:** Modern alternatives (prefer in order):

1. `containerRelativeFrame()` — size relative to container
2. `visualEffect()` — apply effects based on geometry without affecting layout
3. `Layout` protocol — custom layout logic
4. `GeometryReader` — last resort (greedily expands, can cause layout issues)

**Pitfall:** Reaching for `GeometryReader` as a first choice.

---

## Q26. Accessibility of an Icon-Only Button
**Question:** I have a button that only shows an SF Symbol icon. Does this need any special accessibility work?

**Answer:** Yes — include a text label even if only the icon is displayed:

```swift
Button("Delete", systemImage: "trash", action: delete)
```

SwiftUI shows the icon and uses the text for VoiceOver.

**Pitfall:** Creating icon-only buttons without text labels, invisible to VoiceOver and Voice Control.

---

## Q27. Making an Image Interactive
**Question:** I want users to tap on a photo to open it full-screen. What's the best way to make an image tappable?

**Answer:** Use a `Button`, not `onTapGesture`:

```swift
Button("View Photo", systemImage: "photo") {
    showPhoto()
}
```

`onTapGesture` doesn't convey interactivity to assistive technologies. Only use it when you need tap location or count.

**Pitfall:** Using `onTapGesture()` for interactive elements, lacking button semantics.

---

## Q28. Custom Font Size That Respects User Preferences
**Question:** I need text at a specific point size that's larger than body. How do I set a custom font size that still respects the user's text size preferences?

**Answer:** Use `@ScaledMetric` (iOS 18 and earlier) or `.scaled(by:)` (iOS 26+):

```swift
@ScaledMetric private var iconSize = 24.0

// iOS 26+
.font(.body.scaled(by: 1.5))
```

Prefer built-in Dynamic Type sizes (`.title`, `.headline`, `.body`) when possible.

**Pitfall:** Using `.font(.system(size: 24))` which ignores Dynamic Type.

---

## Q29. Slider Layout in a Form
**Question:** I have a Slider inside a Form with a Text label in an HStack. How do I get the label and slider to lay out correctly?

**Answer:** Use `LabeledContent`:

```swift
Form {
    LabeledContent("Volume") {
        Slider(value: $volume, in: 0...100)
    }
}
```

**Pitfall:** Using `HStack { Text("Volume"); Slider(...) }` which doesn't follow Form layout conventions.

---

## Q30. Multiline Text Input with Placeholder
**Question:** I need a multiline text input with placeholder text for user notes. What's the simplest SwiftUI approach?

**Answer:** Use `TextField` with `axis: .vertical`:

```swift
TextField("Enter your notes...", text: $notes, axis: .vertical)
    .lineLimit(5...)
```

`TextEditor` doesn't support placeholder text. Only use it for full-screen editing.

**Pitfall:** Using `TextEditor` which lacks placeholder support.

---

## Q31. Presenting a Detail Sheet from an Optional
**Question:** I have an optional selected item that should open a detail sheet when non-nil. What's the cleanest way to present it?

**Answer:** Use `sheet(item:)`:

```swift
.sheet(item: $selectedItem) { item in
    DetailView(item: item)
}
```

**Pitfall:** Using `sheet(isPresented:)` with manual `if let` unwrapping inside.

---

## Q32. Where to Attach a Confirmation Dialog
**Question:** Where should I attach my `confirmationDialog()` modifier — on the root NavigationStack, or on the button that triggers it?

**Answer:** Attach to the specific element that triggers it. In iOS 26, the dialog animates from its source element (Liquid Glass):

```swift
Button("Delete", role: .destructive) {
    showDeleteConfirmation = true
}
.confirmationDialog("Are you sure?", isPresented: $showDeleteConfirmation) {
    Button("Delete", role: .destructive, action: deleteItem)
}
```

**Pitfall:** Attaching to a parent container, which breaks the source animation.

---

## Q33. Slow-Loading ScrollView with Many Items
**Question:** I have 500 items in a ScrollView with a VStack. The initial load is slow — what's going wrong?

**Answer:** `VStack` renders all 500 items immediately. Use `LazyVStack`:

```swift
ScrollView {
    LazyVStack {
        ForEach(items) { item in
            ItemRow(item: item)
        }
    }
}
```

Only use eager `VStack` for small, fixed numbers of children.

**Pitfall:** Using `VStack` inside `ScrollView` for large data sets.

---

## Q34. Controlling Scroll Indicator Visibility
**Question:** I want to hide scroll indicators in my ScrollView. What's the modern modifier for controlling indicator visibility?

**Answer:** Use `.scrollIndicators(.hidden)`:

```swift
ScrollView { /* content */ }
    .scrollIndicators(.hidden)
```

**Pitfall:** Using the old `ScrollView(showsIndicators: false)` initializer parameter.

---

## Q35. Optimizing Scroll-Edge Rendering
**Question:** My ScrollView has a solid, opaque background. Is there anything I can do to optimize its scroll-edge rendering?

**Answer:** Use `scrollContentBackground(.visible)`:

```swift
ScrollView { /* content */ }
    .scrollContentBackground(.visible)
```

This tells SwiftUI the background is opaque so it can optimize edge effects.

**Pitfall:** Not applying this when the background is known to be solid.

---

## Q36. Loading Data When a View Appears
**Question:** I need to fetch data from an API when a view first appears. What's the recommended way to kick off async work tied to a view's lifecycle?

**Answer:** Use `.task()`:

```swift
.task {
    await loadData()
}
```

It supports `async`/`await` natively and automatically cancels when the view disappears.

**Pitfall:** Using `onAppear` for async work, requiring manual `Task` creation and lacking auto-cancellation.

---

## Q37. Expensive Work in a View Initializer
**Question:** My view initializer fetches data from Core Data and sorts it. Is there a better place to put this work?

**Answer:** View initializers should be trivial. Move work to `.task()`:

```swift
struct ItemListView: View {
    @State private var items: [Item] = []

    var body: some View {
        List(items) { item in Text(item.name) }
            .task { items = try? await fetchAndSort() }
    }
}
```

SwiftUI may recreate views frequently, repeating expensive init work.

**Pitfall:** Performing fetching, sorting, or other non-trivial work in `init()`.

---

## Q38. Toggling Modifiers with if/else
**Question:** I want to change a view's opacity based on a boolean. Should I use `if isActive { view.opacity(1) } else { view.opacity(0.5) }` in my body?

**Answer:** Use a ternary expression:

```swift
MyView()
    .opacity(isActive ? 1 : 0.5)
```

if/else creates `_ConditionalContent`, destroying structural identity — SwiftUI treats the branches as different views, losing state and animations.

**Pitfall:** Using if/else branching to toggle modifier values.

---

## Q39. Returning Different View Types from a Function
**Question:** I have a function that returns different view types depending on a condition, and I'm getting type errors. How do I handle heterogeneous return types from a view-building function?

**Answer:** Use `@ViewBuilder`:

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

Or extract into a separate `View` struct.

**Pitfall:** Wrapping views in `AnyView`, which erases type information and hurts SwiftUI's diffing performance.

---

## Q40. Breaking Up a Long View Body
**Question:** My view body is very long. Should I extract parts into computed properties that return `some View`, decorated with `@ViewBuilder`?

**Answer:** Extract into separate `View` structs, each in its own file:

```swift
// HeaderView.swift
struct HeaderView: View {
    var body: some View { /* header content */ }
}
```

Computed properties and methods don't get the same SwiftUI optimization as dedicated `View` structs.

**Pitfall:** Extracting into `@ViewBuilder` computed properties, which loses performance benefits.

---

## Q41. Multiple View Types in One File
**Question:** I have my ContentView, HeaderView, and FooterView all in the same Swift file. Is that OK?

**Answer:** Each type should be in its own file (`ContentView.swift`, `HeaderView.swift`, `FooterView.swift`). This improves discoverability, reduces merge conflicts, and follows Swift project conventions.

**Pitfall:** Placing multiple type definitions in a single file.

---

## Q42. Defining a Custom Environment Value
**Question:** I want to pass a custom theme value through the SwiftUI environment to all child views. What's the modern way to define a custom environment value?

**Answer:** Use the `@Entry` macro:

```swift
extension EnvironmentValues {
    @Entry var accentTheme: Theme = .default
}
```

This replaces the old boilerplate of creating an `EnvironmentKey` struct. Also works for `FocusValues`, `Transaction`, and `ContainerValues`.

**Pitfall:** Manually creating an `EnvironmentKey` struct with `defaultValue` and extending `EnvironmentValues`.

---

## Q43. Triggering Haptic Feedback
**Question:** I want to trigger haptic feedback when a user completes an action. What's the SwiftUI-native way to do this without bridging to UIKit?

**Answer:** Use `sensoryFeedback()`:

```swift
Button("Complete", action: markComplete)
    .sensoryFeedback(.success, trigger: isCompleted)
```

Available types: `.success`, `.warning`, `.error`, `.impact`, `.selection`.

**Pitfall:** Using UIKit's `UIImpactFeedbackGenerator` or `UINotificationFeedbackGenerator`.

---

## Q44. Updating the UI After a Background Task
**Question:** After a background network call completes, I need to update the UI. How do I ensure code runs on the main thread in modern Swift?

**Answer:** Use `async`/`await` with `@MainActor`:

```swift
func fetchData() async {
    let data = await networkService.load()
    await MainActor.run { self.items = data }
}
```

Or mark the property/class as `@MainActor` so updates happen automatically.

**Pitfall:** Using `DispatchQueue.main.async` or `DispatchQueue.global().async` instead of Swift concurrency.

---

## Q45. Adding a Delay in an Async Context
**Question:** I need to add a 2-second delay before retrying a failed network request. How do I pause execution in an async function?

**Answer:** Use `Task.sleep(for:)` with a `Duration`:

```swift
try await Task.sleep(for: .seconds(2))
```

**Pitfall:** Using `Task.sleep(nanoseconds:)` which is hard to read and error-prone.

---

## Q46. Thread-Safe Shared Cache
**Question:** I have a shared mutable cache that multiple concurrent tasks read from and write to. How do I make this thread-safe in modern Swift?

**Answer:** Use an `actor`:

```swift
actor Cache {
    private var store: [String: Data] = [:]

    func get(_ key: String) -> Data? { store[key] }
    func set(_ key: String, data: Data) { store[key] = data }
}
```

Actors provide compile-time data race protection.

**Pitfall:** Using `DispatchQueue` with sync/async for manual synchronization.

---

## Q47. Getting the User's Documents Directory
**Question:** I need to save a file to the user's documents directory. What's the simplest way to get the documents URL in modern Swift?

**Answer:** Use the `URL` static property:

```swift
let documentsURL = URL.documentsDirectory
let fileURL = URL.documentsDirectory.appending(path: "data.json")
```

**Pitfall:** Using the verbose `FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!`.

---

## Q48. Replacing Substrings in a String
**Question:** I need to replace all occurrences of a substring. What's the preferred Swift-native string method?

**Answer:** Use `replacing()`:

```swift
let result = myString.replacing("a", with: "b")
```

Prefer Swift-native string methods over Foundation equivalents.

**Pitfall:** Using the Foundation method `replacingOccurrences(of:with:)`.

---

## Q49. ForEach with Index and Item
**Question:** I want to iterate over an array with indices using `ForEach`. Should I convert `items.enumerated()` to an `Array` first, like `Array(items.enumerated())`?

**Answer:** Don't convert to an array — use `enumerated()` directly, and identify by the element, not the offset:

```swift
ForEach(items.enumerated(), id: \.element.id) { index, item in
    Text("\(index + 1). \(item.name)")
}
```

**Pitfall:** Wrapping in `Array()` unnecessarily and using `\.offset` for identity, which is fragile when the array changes.

---

## Q50. Avoiding Repeated id: Parameters
**Question:** My data types don't have a dedicated ID property. I've been specifying `id: \.name` at every ForEach and List call site. Is there a better pattern?

**Answer:** Conform your type to `Identifiable`:

```swift
struct Item: Identifiable {
    let id = UUID()
    var name: String
}

ForEach(items) { item in Text(item.name) }
```

**Pitfall:** Repeating `id: \.someProperty` at every call site instead of conforming once.

---

## Q51. Displaying a Web Page in SwiftUI
**Question:** I need to display a web page inside my SwiftUI app. What's the simplest approach on iOS 26?

**Answer:** iOS 26 has a native `WebView`:

```swift
import WebKit

struct BrowserView: View {
    var body: some View {
        WebView(url: URL(string: "https://example.com")!)
    }
}
```

**Pitfall:** Creating a `UIViewRepresentable` wrapper around `WKWebView` when a native view exists.

---

## Q52. Storing Sensitive Data Across Launches
**Question:** Can I store the user's authentication token in `@AppStorage` so it persists across launches?

**Answer:** Never store secrets in `@AppStorage` — it uses `UserDefaults`, which is unencrypted. Use the Keychain:

```swift
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrAccount as String: "authToken",
    kSecValueData as String: tokenData
]
SecItemAdd(query as CFDictionary, nil)
```

`@AppStorage` is fine for non-sensitive preferences (theme, font size).

**Pitfall:** Storing secrets in unencrypted `UserDefaults`.

---

## Q53. Displaying an Icon Next to a Label
**Question:** Should I use an HStack with an Image and Text to show an icon next to a label?

**Answer:** Use `Label`:

```swift
Label("Downloads", systemImage: "arrow.down.circle")
```

`Label` handles layout across contexts (list rows, menus, buttons) and provides proper accessibility semantics.

**Pitfall:** Using `HStack { Image(systemName:); Text() }` which doesn't adapt to context.

---

## Q54. Large Animations and User Sensitivity
**Question:** I have a large slide-in animation when my view appears. Do I need to check any user settings before playing it?

**Answer:** Check `accessibilityReduceMotion` and replace large motion with opacity fades:

```swift
@Environment(\.accessibilityReduceMotion) private var reduceMotion

ContentView()
    .transition(reduceMotion ? .opacity : .slide)
```

**Pitfall:** Playing large animations without checking user preferences, causing discomfort for motion-sensitive users.

---

## Q55. Counting Items That Match a Condition
**Question:** I need to count how many items in an array match a condition. Is filtering then counting the best approach?

**Answer:** Use `count(where:)`:

```swift
let completedCount = tasks.count(where: \.isCompleted)
```

**Pitfall:** Using `filter { }.count` which allocates an intermediate array.

---

## Q56. Capturing a SwiftUI View as a Bitmap
**Question:** I need to capture a SwiftUI view as a bitmap image for sharing. What's the SwiftUI-native approach?

**Answer:** Use `ImageRenderer`:

```swift
let renderer = ImageRenderer(content: MyView())
if let image = renderer.uiImage {
    // use the UIImage
}
```

**Pitfall:** Using UIKit's `UIGraphicsImageRenderer`, which requires bridging through a hosting controller.

---

## Q57. Unique Constraints in SwiftData with CloudKit
**Question:** I want to enforce uniqueness on my SwiftData model's `email` property. Should I add `@Attribute(.unique)` to it?

**Answer:** If using CloudKit sync, never use `@Attribute(.unique)` — CloudKit doesn't support unique constraints and sync will fail. Handle uniqueness in application logic or check before insert.

**Pitfall:** Using `@Attribute(.unique)` in a CloudKit-synced model.

---

## Q58. SwiftData Relationships with CloudKit
**Question:** My SwiftData model has a `tags` relationship defined as `var tags: [Tag]`. Does it need to be optional for CloudKit?

**Answer:** Yes. All CloudKit-synced SwiftData relationships must be optional, and all properties must have defaults:

```swift
@Model
class Article {
    var title: String = ""
    var tags: [Tag]? // Must be optional for CloudKit
}
```

**Pitfall:** Non-optional relationships causing CloudKit sync failures.

---

## Q59. Displaying a Person's Full Name
**Question:** I have `firstName` and `lastName` strings. Should I display them as `Text("\(firstName) \(lastName)")`?

**Answer:** Use `PersonNameComponents` — name order varies by culture:

```swift
var name: PersonNameComponents {
    var c = PersonNameComponents()
    c.givenName = firstName
    c.familyName = lastName
    return c
}

Text(name.formatted(.name(style: .long)))
```

**Pitfall:** String interpolation assumes Western name ordering, breaking for other cultures.

---

## Q60. Overlaying a Badge on an Image
**Question:** I want to overlay a notification badge on the top-right corner of a product image. What's the correct overlay syntax in modern SwiftUI?

**Answer:** Use the trailing-closure form:

```swift
Image("product")
    .overlay(alignment: .topTrailing) {
        BadgeView()
    }
```

**Pitfall:** Using the deprecated `.overlay(SomeView(), alignment:)` syntax where the view is the first argument.

---

## Q61. Sharing Mutable State with a Child View
**Question:** I declared `@State var count = 0` in my view. A child view also needs to mutate it — should the child also declare `@State var count`?

**Answer:** No. `@State` is private and owned by one view. Pass a binding:

```swift
// Parent
@State private var count = 0
var body: some View { ChildView(count: $count) }

// Child
struct ChildView: View {
    @Binding var count: Int
}
```

If the child only reads, pass the value as `let`.

**Pitfall:** Declaring `@State` in multiple views for the same data, creating independent copies.

---

## Q62. Setting Up SwiftUI Previews
**Question:** I need to set up previews for my view. What's the modern preview syntax?

**Answer:** Use the `#Preview` macro:

```swift
#Preview {
    ContentView()
}

#Preview("Dark Mode") {
    ContentView()
        .preferredColorScheme(.dark)
}
```

**Pitfall:** Using the legacy `PreviewProvider` protocol with `static var previews`.

---

## Q63. Menu with Only an Icon Label
**Question:** I'm creating a `Menu` with just an SF Symbol icon as its label. Is that sufficient?

**Answer:** No — include a text label:

```swift
Menu("Options", systemImage: "ellipsis.circle") {
    Button("Edit", action: edit)
    Button("Delete", role: .destructive, action: delete)
}
```

The text label is used by VoiceOver even if only the icon is displayed.

**Pitfall:** Icon-only Menu labels, invisible to assistive technology.

---

## Q64. Color-Only Status Indicators
**Question:** I'm using colored circles to indicate status: red for error, yellow for warning, green for OK. Is this enough?

**Answer:** Color alone isn't sufficient. Check `accessibilityDifferentiateWithoutColor` and provide secondary indicators:

```swift
@Environment(\.accessibilityDifferentiateWithoutColor) private var differentiateWithoutColor

HStack {
    Circle().fill(statusColor).frame(width: 12, height: 12)
    if differentiateWithoutColor {
        Image(systemName: statusIcon)
    }
    Text(statusLabel)
}
```

**Pitfall:** Using only color to convey meaning — unusable for colorblind users.

---

## Q65. Type-Safe Asset Catalog References
**Question:** I'm loading images from my asset catalog using string names. Is there a safer way to reference assets that catches errors at compile time?

**Answer:** Use generated asset symbols:

```swift
Image(.avatar)  // instead of Image("avatar")
```

This provides compile-time safety — errors surface if the asset is renamed or deleted.

**Pitfall:** String-based `Image("avatar")` which fails silently at runtime.

---

## Q66. Accepting Child Content in a Custom View
**Question:** I'm building a `CardView<Content: View>` that accepts child content via a `let content: () -> Content` closure property. Is this the right way?

**Answer:** Store the built view value instead of an escaping closure:

```swift
struct CardView<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading) { content }
            .padding()
            .background(.ultraThinMaterial)
            .clipShape(.rect(cornerRadius: 8))
    }
}
```

**Pitfall:** Storing `() -> Content` as an escaping closure, which has overhead and is called repeatedly.

---

## Q67. Parsing an ISO 8601 Date String
**Question:** I have an ISO 8601 date string from an API that I need to convert to a `Date`. What's the cleanest approach?

**Answer:** Use the modern `Date` initializer with a parse strategy:

```swift
let date = try Date("2026-04-07T12:00:00Z", strategy: .iso8601)
```

**Pitfall:** Creating an `ISO8601DateFormatter` instance when a one-line initializer exists.

---

## Q68. Handling Errors from User Actions
**Question:** In my `catch` block, I'm calling `print(error.localizedDescription)` to log the error. Is there anything else I should do?

**Answer:** Errors from user actions must be surfaced to the user, not silently swallowed:

```swift
@State private var errorMessage: String?
@State private var showError = false

func save() {
    do { try dataStore.save() }
    catch {
        errorMessage = error.localizedDescription
        showError = true
    }
}

// In body:
.alert("Save Failed", isPresented: $showError) { }
    message: { Text(errorMessage ?? "Unknown error") }
```

`print()` in a catch is only appropriate for development debugging.

**Pitfall:** Using `print()` as the only error handling for user-initiated actions.

---

## Q69. Missing Combine at Runtime
**Question:** I'm using a Combine publisher for debouncing in my ObservableObject, but I'm getting a runtime error about missing Combine. What's wrong?

**Answer:** You need to explicitly `import Combine`. It's no longer provided implicitly through SwiftUI:

```swift
import SwiftUI
import Combine

class SearchDebouncer: ObservableObject {
    @Published var searchText = ""
    // Combine publisher setup...
}
```

Note: `ObservableObject` is legacy but is still appropriate when you need Combine publishers for debouncing.

**Pitfall:** Assuming `import SwiftUI` provides Combine implicitly.

---

## Q70. Subtle Text Hierarchy with Transparency
**Question:** I want my subtitle text to be slightly transparent to create visual hierarchy. Should I use `.opacity(0.6)` on the Text?

**Answer:** Use hierarchical styles which adapt to context automatically:

```swift
Text("Subtitle")
    .foregroundStyle(.secondary)
```

Available: `.primary`, `.secondary`, `.tertiary`, `.quaternary`. These adapt to light/dark mode and accessibility settings.

**Pitfall:** Using `.opacity(0.6)` which doesn't adapt to different appearances.

---

## Q71. Where to Attach an Accessibility Label
**Question:** Can I add a hidden `accessibilityLabel` to the Image inside my button instead of labeling the button itself?

**Answer:** No. The accessibility label should be attached to the interactive element — the button — not the decorative image inside it. Use `Button("Delete", systemImage: "trash", action: delete)` which provides the label to the button itself. If you label only the image, VoiceOver may not associate the label with the tappable control.

**Pitfall:** Attaching accessibility labels to decorative child views instead of the interactive parent.

*(Source: mercury2)*

---

## Q72. Hiding an Interactive Element from VoiceOver
**Question:** Is it okay to use `accessibilityHidden(true)` on an interactive control to stop VoiceOver from reading it?

**Answer:** Never hide interactive elements from VoiceOver. This makes the control completely invisible to users who rely on assistive technology. Instead, provide a proper text label. If VoiceOver reads something unexpected, fix the label rather than hiding the element.

**Pitfall:** Using `accessibilityHidden(true)` on buttons or other interactive controls.

*(Source: mercury2)*

---

## Q73. Mixing Old and New Navigation APIs
**Question:** Can I nest a `NavigationStack` inside a `NavigationView` to get the best of both APIs during a migration?

**Answer:** No. Replace `NavigationView` entirely with `NavigationStack`. Nesting them causes undefined behavior, double navigation bars, and broken push/pop animations. `NavigationStack` is the complete replacement, not a supplement.

**Pitfall:** Wrapping `NavigationStack` inside `NavigationView` during an incremental migration.

*(Source: mercury2)*

---

## Q74. Heavy Computation in a View Body
**Question:** Is it okay to do expensive work like JSON parsing in the view body, since SwiftUI caches view values between renders?

**Answer:** No. SwiftUI does not cache view body evaluations. The `body` property is re-evaluated on every state change. Expensive work like parsing, sorting, or network calls should be in `.task()` or your data model layer:

```swift
@State private var items: [Item] = []

var body: some View {
    List(items) { item in Text(item.name) }
        .task { items = try? await parseAndLoad() }
}
```

**Pitfall:** Assuming SwiftUI caches body computations. It doesn't — body runs on every state change.

*(Source: mercury2)*

---

## Q75. Calling Async Code from a Button
**Question:** Can I call an async function directly inside a button's action closure?

**Answer:** Button action closures are synchronous. Wrap async calls in `Task`:

```swift
Button("Load") {
    Task {
        await loadData()
    }
}
```

For async work tied to state changes, prefer `.task()` with a trigger value. Avoid creating tasks in `body` or `init`.

**Pitfall:** Attempting to use `await` in a synchronous button closure.

*(Source: mercury2)*
