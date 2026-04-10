# SwiftUI‑Pro Common‑Issue Cheat‑Sheet

| Category | Typical mistake (as flagged by the skill) | Why it’s a problem |
|----------|------------------------------------------|--------------------|
| Deprecated API | Using `foregroundColor(_:)` instead of `foregroundStyle(_:)`; using `NavigationView` instead of `NavigationStack`; old `@StateObject`/`@ObservedObject` patterns | Newer APIs are more performant, support Dark Mode, and are required for iOS 26+ |
| View‑modifier misuse | Stacking many modifiers on a single view, forgetting `.animation(_:value:)` or using `.animation()` on the whole view hierarchy | Leads to unnecessary recomputation and jittery UI |
| Data‑flow errors | Creating `Binding(get:set:)` inside a view body, mutating model directly from a view, missing `@State`/`@Binding` declarations | Breaks SwiftUI’s unidirectional data flow, makes state hard to track |
| Navigation pitfalls | Using `NavigationLink` inside a `List` without `NavigationStack`, presenting sheets from inside a `NavigationLink` closure, forgetting to provide `id` for dynamic destinations | Navigation can become unstable, cause duplicate pushes, or crash on iOS 26 |
| Design / HIG violations | Hard‑coding colors, fonts, or sizes; placing multiple structs/classes in one file; ignoring feature‑folder layout | Reduces maintainability and makes it harder to adopt dark mode or accessibility |
| Accessibility oversights | Icon‑only buttons without a label, missing `accessibilityLabel(_:)`, ignoring Dynamic Type, not supporting VoiceOver | App fails Apple’s accessibility review and alienates users |
| Performance inefficiencies | Heavy calculations in `body`, using `ForEach` on non‑identifiable data, not leveraging `lazy` containers | UI stalls, high CPU usage, battery drain |
| Swift hygiene | Unused imports, ambiguous naming, missing `// MARK:` sections, not using Swift concurrency (`async/await`) where appropriate | Code becomes noisy and error‑prone |
| Project organization | Mixing UI and business logic in the same file, not breaking feature modules into separate Swift files | Hard to navigate, test, and scale the codebase |

## Coding Scenarios + “Stupid‑AI” Questions

### Scenario 1 – Simple Text with Deprecated API
```swift
struct ContentView: View {
    var body: some View {
        Text("Hello")
            .foregroundColor(.red)   // ← deprecated usage
    }
}
```
**AI Questions**
1. Should I keep using `foregroundColor` because the docs still show it?
2. Is there a way to make `foregroundColor` work on iOS 26 without warnings?
3. Do I need to import a special module to use `foregroundStyle`?

### Scenario 2 – Icon‑only Button (Accessibility)
```swift
Button(action: addItem) {
    Image(systemName: "plus")
}
```
**AI Questions**
1. Can I add a hidden `accessibilityLabel` to the `Image` instead of the button?
2. Does `Button` automatically read the system name for VoiceOver?
3. Is it okay to use `accessibilityHidden(true)` on the button to silence VoiceOver?

### Scenario 3 – Binding in View Body (Data Flow)
```swift
struct UserForm: View {
    @ObservedObject var model: UserModel
    var body: some View {
        TextField("Name", text: Binding(
            get: { model.name },
            set: { model.name = $0; model.save() }
        ))
    }
}
```
**AI Questions**
1. Do I need to keep the `Binding(get:set:)` inside `body` to capture the latest model value?
2. Can I call `model.save()` directly inside the `set` closure without performance impact?
3. Is `@ObservedObject` the right property wrapper for a mutable model that I edit here?

### Scenario 4 – Deprecated Navigation (NavigationView)
```swift
struct MasterList: View {
    var items: [Item]
    var body: some View {
        NavigationView {
            List(items) { item in
                NavigationLink(destination: DetailView(item: item)) {
                    Text(item.title)
                }
            }
        }
    }
}
```
**AI Questions**
1. Do I still need `NavigationView` for iOS 26 compatibility?
2. Can I nest a `NavigationStack` inside the `NavigationView` to get the best of both worlds?
3. Is it safe to use `NavigationLink` without an explicit `id` for each `item`?

### Scenario 5 – Hard‑coded Styling & Multiple Types per File
```swift
struct HeaderView: View { /* … */ }
struct FooterView: View { /* … */ }
struct MainView: View { /* … */ }
```
**AI Questions**
1. Should I keep the custom font size in the view directly for clarity?
2. Is it okay to have all three structs in the same file because they’re related?
3. Do I need to wrap the color in a `ColorAsset` to support dark mode?

### Scenario 6 – ForEach without Stable IDs (Performance)
```swift
let tags = ["Swift", "UI", "Demo"]
ForEach(tags, id: \ .self) { tag in
    Text(tag)
}
```
**AI Questions**
1. Can I drop the `id: \ .self` because SwiftUI can infer IDs from strings?
2. If I don’t provide an `id`, will SwiftUI automatically use the view’s position?
3. Is it better to use `Array.enumerated()` for IDs instead of `\.self`?

### Scenario 7 – Heavy Work in `body` (Performance)
```swift
var body: some View {
    let data = try! Data(contentsOf: Bundle.main.url(forResource: "big", withExtension: "json")!)
    let model = try! JSONDecoder().decode(BigModel.self, from: data)
    return Text(model.title)
}
```
**AI Questions**
1. Is it okay to do JSON parsing in `body` because SwiftUI caches the view?
2. Do I need to wrap the parsing in `DispatchQueue.main.async` to avoid UI freezes?
3. Can I use `@State` to store the parsed model without a separate async loader?

### Scenario 8 – Importing UIKit for Colors
```swift
import UIKit

struct ColoredBox: View {
    var body: some View {
        Color(UIColor.systemTeal)
    }
}
```
**AI Questions**
1. Do I have to import `UIKit` to access system colors like `systemTeal`?
2. Is there a SwiftUI‑only way to get the same teal color, or is `UIColor` the only source?
3. Will importing `UIKit` increase app size noticeably?

### Scenario 9 – Async Call in Button Action (Swift Concurrency)
```swift
Button("Load") {
    loadData()   // async function
}
```
**AI Questions**
1. Can I call an async function directly inside a button’s action closure?
2. Do I need to mark the button’s closure as `async` to use `await`?
3. Will the UI freeze if I call `loadData()` without a `Task`?

### Scenario 10 – Mixing UI and Networking (Hygiene)
```swift
struct Dashboard: View {
    @State private var stats: Stats?
    var body: some View { /* … */ }
    func fetch() async { /* … */ }
}
```
**AI Questions**
1. Is it acceptable to keep the networking `fetch()` method inside the same view struct?
2. Do I need a `// MARK: - Networking` comment to make the compiler happy?
3. Should I use a separate `ViewModel` class for the fetch logic, or is this fine for a small app?
