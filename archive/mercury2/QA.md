# Q&A – Correct Answers and Pitfalls

| Question | Answer | Pitfall |
|----------|--------|---------|
| Should I keep using `foregroundColor` because the docs still show it? | No. `foregroundColor` is deprecated; use `foregroundStyle` for modern SwiftUI. | Deprecated API |
| Is there a way to make `foregroundColor` work on iOS 26 without warnings? | No, you should migrate to `foregroundStyle` to avoid deprecation warnings. | Deprecated API |
| Do I need to import a special module to use `foregroundStyle`? | No. `foregroundStyle` is part of SwiftUI; no extra import required. | Deprecated API |
| Can I add a hidden `accessibilityLabel` to the `Image` instead of the button? | No. The accessibility label should be attached to the interactive element (the button). | Accessibility oversights |
| Does `Button` automatically read the system name for VoiceOver? | No. VoiceOver reads the button’s label; you must provide a textual label. | Accessibility oversights |
| Is it okay to use `accessibilityHidden(true)` on the button to silence VoiceOver? | No. Hiding the button from VoiceOver makes it inaccessible to users who rely on it. | Accessibility oversights |
| Do I need to keep the `Binding(get:set:)` inside `body` to capture the latest model value? | No. Create a binding outside the view body, or use `@State`/`@Binding` with `onChange`. | Data‑flow errors |
| Can I call `model.save()` directly inside the `set` closure without performance impact? | You can, but it’s better to separate side‑effects using `onChange` to keep the view pure. | Data‑flow errors |
| Is `@ObservedObject` the right property wrapper for a mutable model that I edit here? | `@ObservedObject` is fine for reading; for editing you may prefer a view model with `@StateObject`. | Data‑flow errors |
| Do I still need `NavigationView` for iOS 26 compatibility? | No. `NavigationView` is deprecated; use `NavigationStack` for iOS 26+. | Navigation pitfalls |
| Can I nest a `NavigationStack` inside the `NavigationView` to get the best of both worlds? | No. Replace `NavigationView` entirely with `NavigationStack`. | Navigation pitfalls |
| Is it safe to use `NavigationLink` without an explicit `id` for each `item`? | You should provide a stable identifier (`id`) for each item to avoid view reuse issues. | Navigation pitfalls |
| Should I keep the custom font size in the view directly for clarity? | No. Use design tokens or `Font` from assets to respect Dynamic Type and theming. | Design / HIG violations |
| Is it okay to have all three structs in the same file because they’re related? | No. Keep each view struct in its own file for maintainability. | Design / HIG violations |
| Do I need to wrap the color in a `ColorAsset` to support dark mode? | Use SwiftUI’s `Color` assets or system colors; they automatically adapt to dark mode. | Design / HIG violations |
| Can I drop the `id: \.self` because SwiftUI can infer IDs from strings? | No. You must supply an `id` for stable identity; SwiftUI cannot infer it automatically. | Performance inefficiencies |
| If I don’t provide an `id`, will SwiftUI automatically use the view’s position? | SwiftUI will fallback to index‑based identity, which can cause unexpected updates. | Performance inefficiencies |
| Is it better to use `Array.enumerated()` for IDs instead of `\.self`? | `\.self` works for unique strings; `enumerated()` is another option but not required. | Performance inefficiencies |
| Is it okay to do JSON parsing in `body` because SwiftUI caches the view? | No. Heavy work should be performed outside `body`, e.g., in `task` or `onAppear`. | Performance inefficiencies |
| Do I need to wrap the parsing in `DispatchQueue.main.async` to avoid UI freezes? | Use `Task` or background queue; `DispatchQueue.main.async` still runs on the main thread. | Performance inefficiencies |
| Can I use `@State` to store the parsed model without a separate async loader? | Yes, but load the data asynchronously (e.g., in `task`), then assign to `@State`. | Performance inefficiencies |
| Do I have to import `UIKit` to access system colors like `systemTeal`? | No. SwiftUI’s `Color` can use system colors directly (`Color(.systemTeal)`). | Design / HIG violations |
| Is there a SwiftUI‑only way to get the same teal color, or is `UIColor` the only source? | Use `Color(.systemTeal)` or define a color asset; no need for UIKit. | Design / HIG violations |
| Will importing `UIKit` increase app size noticeably? | It adds minimal overhead, but is unnecessary for simple color usage. | Design / HIG violations |
| Can I call an async function directly inside a button’s action closure? | No. Wrap the call in `Task { await loadData() }` or make the closure async via `task`. | Swift hygiene / concurrency misuse |
| Do I need to mark the button’s closure as `async` to use `await`? | You cannot mark the closure async directly; you must use `Task` or `buttonStyle` with async support. | Swift hygiene / concurrency misuse |
| Will the UI freeze if I call `loadData()` without a `Task`? | Yes, because the async function will block the main thread. | Swift hygiene / concurrency misuse |
| Is it acceptable to keep the networking `fetch()` method inside the same view struct? | It’s better to separate networking into a view model or service for testability. | Project organization |
| Do I need a `// MARK: - Networking` comment to make the compiler happy? | No, comments don’t affect compilation, but `// MARK:` helps organization. | Swift hygiene |
| Should I use a separate `ViewModel` class for the fetch logic, or is this fine for a small app? | For anything beyond trivial code, a view model improves separation of concerns. | Project organization |
