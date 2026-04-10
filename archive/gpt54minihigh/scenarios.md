# SwiftUI mistake scenarios

This file turns the `swiftui-pro` reference into coding scenarios that commonly trigger the mistakes called out in the skill. Each scenario includes the likely pitfalls and the kind of question a confused model might ask when it has access to Swift docs but still tends to make the same errors.

## 1. Searchable contacts list with empty state

**Scenario**
A screen shows a large list of contacts, a search bar, and an empty-results message. Tapping a row opens a detail screen.

**Common pitfalls**
- `contains()` instead of `localizedStandardContains()`
- Expensive filtering inside `ForEach`
- `NavigationView` instead of `NavigationStack`
- `NavigationLink(destination:)` instead of `navigationDestination(for:)`
- Custom empty state instead of `ContentUnavailableView`
- `showsIndicators: false` instead of `.scrollIndicators(.hidden)`

**Likely bad questions**
- Should I use `contains()` or `localizedStandardContains()` for search filtering?
- Can I keep using `NavigationView` for a simple master-detail layout?
- Is `showsIndicators: false` still the right way to hide the scroll bar?
- Should I build my own empty state view, or is there a built-in view for that?

## 2. Profile editor form

**Scenario**
A form lets users edit their name, bio, and avatar, with a Save button and live validation.

**Common pitfalls**
- `Binding(get:set:)` in the view body
- `TextEditor` when `TextField(axis: .vertical)` would be better
- Inline business logic in `body`
- `@ObservedObject` / `ObservableObject` when `@Observable` would fit better
- Missing accessibility labels for avatar or image buttons

**Likely bad questions**
- Can I create a custom binding inline so I can save on every keystroke?
- Should I use `TextEditor` for the bio even though I want placeholder text?
- Is it fine to keep the save validation inline in the `body`?
- Do I need `ObservableObject`, or should I use `@Observable` here?

## 3. Tab-based app shell

**Scenario**
The app has Home, Search, and Settings tabs.

**Common pitfalls**
- Using `tabItem()` instead of the modern `Tab` API
- Using integers or strings for tab selection instead of an enum
- Mixing outdated and modern tab patterns
- Poor state ownership for selected tab

**Likely bad questions**
- Can I still use `.tabItem()` for tabs, or is there a better API?
- Is it okay to use `0`, `1`, `2` for tab selection?
- Should tab selection be stored as a string or enum?

## 4. Reusable card view with custom content

**Scenario**
You are making a reusable card component that wraps arbitrary child content.

**Common pitfalls**
- Storing escaping `@ViewBuilder` closures on the view
- Using `AnyView` to simplify generics
- Too many subviews or computed properties inside one file
- Using computed properties returning `some View` instead of separate view types

**Likely bad questions**
- Can I store the card’s content as an escaping closure?
- Would `AnyView` make this reusable card easier to build?
- Can I just make a few computed properties returning `some View`?
- Do I really need separate files for these tiny subviews?

## 5. Animated progress indicator or onboarding animation

**Scenario**
A progress ring or onboarding card animates between states.

**Common pitfalls**
- Using `.animation(_:)` without a value
- Chaining animations with multiple `withAnimation()` calls and delays
- Hand-writing `animatableData` instead of using `@Animatable`
- Ignoring Reduce Motion

**Likely bad questions**
- Can I use `.animation(.easeInOut)` without specifying a value?
- If I want two animations in sequence, can I just call `withAnimation` twice?
- Do I need to write `animatableData` manually, or is there a newer macro?
- Should I do anything special if the user has Reduce Motion enabled?

## 6. Settings store or app preferences

**Scenario**
There’s a shared settings model holding theme, username, and notification preferences.

**Common pitfalls**
- `@AppStorage` inside `@Observable`
- Missing `@MainActor` on observable models
- Legacy `ObservableObject`, `@Published`, `@StateObject`, `@ObservedObject`, or `@EnvironmentObject` when modern observation would work better
- Storing sensitive data in `@AppStorage`

**Likely bad questions**
- Can I put `@AppStorage` inside my `@Observable` settings object?
- Do I need to mark this observable model as `@MainActor`?
- Is `ObservableObject` still acceptable here?
- Can I store the user’s password in `@AppStorage` if it’s just for convenience?

## 7. Detail sheet, delete confirmation, and alert flow

**Scenario**
A list item can be edited in a sheet, deleted with a confirmation dialog, and maybe shows a small alert.

**Common pitfalls**
- Using `sheet(isPresented:)` instead of `sheet(item:)`
- Attaching `confirmationDialog()` to the wrong view
- Showing pointless “OK” alerts
- Old presentation patterns that do not animate correctly

**Likely bad questions**
- Should I use `sheet(isPresented:)` even though I already have an optional item?
- Where should I attach the confirmation dialog so it animates correctly?
- Do I need a custom alert just to show “OK” and dismiss?
- Can I pass the selected item into the sheet manually instead of using `sheet(item:)`?

## 8. Large dashboard with many tiles

**Scenario**
A dashboard shows lots of cards in a scrollable grid, with sorting, filtering, and dynamic spacing.

**Common pitfalls**
- `UIScreen.main.bounds`
- Fixed frames
- Heavy logic in `body`
- Eager `VStack` / `HStack` with many children
- Expensive inline transforms in `List` / `ForEach`
- Sorting and filtering inside `body`

**Likely bad questions**
- Can I use `UIScreen.main.bounds.width` to size the tiles?
- Is a fixed frame okay if the design looks good on my device?
- Should I sort and filter the items right inside `body`?
- Do I need `LazyVStack` for a large list of dashboard cards?

## 9. Search results with localized text and formatting

**Scenario**
Search results show names, dates, and prices, possibly in multiple languages.

**Common pitfalls**
- Manual string formatting
- `String(format:)`
- Simple string interpolation for person names
- `Text` concatenation with `+`
- Bad year formatting using `yyyy` instead of `y`
- Using `Date()` instead of `Date.now`

**Likely bad questions**
- Can I use `String(format:)` for prices and dates?
- Is `Text("Hello") + Text("World")` still acceptable?
- Should I just interpolate first and last name with a space?
- If I manually format dates, is `yyyy` the right year token?

## 10. Image-heavy gallery or icon-based interface

**Scenario**
A gallery shows images from an asset catalog, plus icon-only controls.

**Common pitfalls**
- `Image("name")` instead of generated asset symbols
- Decorative images with poor VoiceOver behavior
- Icon-only buttons without labels
- Menus shown as just images
- Missing accessibility labels for meaningful images

**Likely bad questions**
- Should I use `Image("avatar")` or the generated asset API?
- Do decorative images need accessibility labels?
- Is an icon-only button okay if the icon is obvious?
- Should I use `Menu` with only an image, or does it need text too?

## 11. Async data load / refresh screen

**Scenario**
A screen loads remote data, refreshes when shown, and may retry after failure.

**Common pitfalls**
- Using `onAppear()` for async work instead of `task()`
- `DispatchQueue.main.async`
- `Task.sleep(nanoseconds:)`
- Swallowing user-facing errors
- Closure-based APIs when async/await exists

**Likely bad questions**
- Should I start the fetch in `onAppear()` or `task()`?
- Can I use `DispatchQueue.main.async` to update the UI after the fetch?
- Is `Task.sleep(nanoseconds:)` still the preferred way to delay a retry?
- If the request fails, is it okay to just print the error?

## 12. Multi-part custom screen with lots of subviews

**Scenario**
A complex screen has a header, stats, list, filters, and actions.

**Common pitfalls**
- Huge `body`
- Computed properties returning `some View`
- Button logic mixed into view layout
- Multiple types in one file
- Poor separation of UI and logic

**Likely bad questions**
- Can I keep this whole screen in one `body` if it’s readable to me?
- Is it okay to use `@ViewBuilder` computed properties instead of separate view types?
- Should I leave the button action inline since it’s only one line?
- Do multiple structs in one file really matter?

## 13. Interactive row or custom tappable element

**Scenario**
A row opens a detail screen or toggles some state.

**Common pitfalls**
- `onTapGesture()` instead of `Button`
- Missing accessibility traits for non-button tap targets
- Unclear tap affordances

**Likely bad questions**
- Can I just use `onTapGesture()` on this row instead of a `Button`?
- If I use `onTapGesture()`, do I need extra accessibility traits?
- How do I make this custom row feel like a real button to VoiceOver?

## 14. Color-coded status badges or charts

**Scenario**
Items are labeled as success, warning, or error using colors.

**Common pitfalls**
- Relying on color alone
- Not respecting `accessibilityDifferentiateWithoutColor`
- Using custom opacity instead of system hierarchical styles

**Likely bad questions**
- Is color enough to distinguish these statuses?
- Do I need to show an icon or pattern too?
- Should I use manual opacity, or is there a system style for this?

## 15. Form with controls inside a `Form`

**Scenario**
A settings form includes sliders, toggles, and labels.

**Common pitfalls**
- Not using `LabeledContent` for controls like `Slider`
- Using `fontWeight(.bold)` instead of `bold()`
- Using tiny fonts like `.caption2` too much

**Likely bad questions**
- Do I need `LabeledContent` for the slider, or can I just put it in a stack?
- Is `fontWeight(.semibold)` better than `bold()` here?
- Can I use `.caption2` if I want the settings screen to feel compact?
