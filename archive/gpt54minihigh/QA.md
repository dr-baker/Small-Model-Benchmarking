# QA

Format for each entry:

- **Question**
- **Answer**
- **Pitfall**

## 1. Searchable contacts list

- **Question:** Should I use `contains()` or `localizedStandardContains()` for search filtering?
- **Answer:** Use `localizedStandardContains()`.
- **Pitfall:** `contains()` is not the recommended choice for user-entered search text.

## 2. Profile editor form

- **Question:** Can I create a custom binding inline so I can save on every keystroke?
- **Answer:** Prefer the binding from `@State` / `@Binding`, then use `onChange()` for side effects.
- **Pitfall:** `Binding(get:set:)` in the view body is brittle and harder to maintain.

## 3. Tab-based app shell

- **Question:** Can I still use `.tabItem()` for tabs, or is there a better API?
- **Answer:** Use the modern `Tab` API.
- **Pitfall:** `tabItem()` is the older pattern and does not match current SwiftUI guidance.

## 4. Reusable card view

- **Question:** Can I store the card’s content as an escaping closure?
- **Answer:** Prefer storing the built view value with `@ViewBuilder let content: Content`.
- **Pitfall:** Escaping `@ViewBuilder` closures are less ideal than storing the constructed content.

## 5. Animated progress indicator

- **Question:** Can I use `.animation(.easeInOut)` without specifying a value?
- **Answer:** No. Always provide the value being watched.
- **Pitfall:** The value-less `animation(_:)` pattern is discouraged.

## 6. Settings store

- **Question:** Can I put `@AppStorage` inside my `@Observable` settings object?
- **Answer:** No. Keep `@AppStorage` out of `@Observable` classes.
- **Pitfall:** Changes will not correctly drive view updates there.

## 7. Detail sheet and confirmation flow

- **Question:** Should I use `sheet(isPresented:)` even though I already have an optional item?
- **Answer:** Use `sheet(item:)`.
- **Pitfall:** `sheet(isPresented:)` loses the safety of optional unwrapping.

## 8. Large dashboard

- **Question:** Can I use `UIScreen.main.bounds.width` to size the tiles?
- **Answer:** Prefer `containerRelativeFrame()`, `visualEffect()`, or another SwiftUI-native approach.
- **Pitfall:** Reading screen size directly makes layouts less adaptive.

## 9. Localized text and formatting

- **Question:** Can I use `String(format:)` for prices and dates?
- **Answer:** Prefer `Text` with `FormatStyle` APIs and modern date formatting.
- **Pitfall:** Manual formatting is less localizable and less consistent.

## 10. Image-heavy gallery

- **Question:** Is an icon-only button okay if the icon is obvious?
- **Answer:** No. Buttons with image labels must include text.
- **Pitfall:** Icon-only controls are bad for VoiceOver and accessibility.

## 11. Async refresh screen

- **Question:** Should I start the fetch in `onAppear()` or `task()`?
- **Answer:** Use `task()` for async work.
- **Pitfall:** `onAppear()` is less cancel-safe for asynchronous loading.

## 12. Complex screen structure

- **Question:** Can I keep this whole screen in one `body` if it’s readable to me?
- **Answer:** Break it into separate view structs in separate files.
- **Pitfall:** Huge bodies and inline logic hurt maintainability and performance.

## 13. Interactive row

- **Question:** Can I just use `onTapGesture()` on this row instead of a `Button`?
- **Answer:** Use `Button` unless you specifically need tap location or count.
- **Pitfall:** `onTapGesture()` is less accessible and less semantically correct.

## 14. Color-coded status badges

- **Question:** Is color enough to distinguish these statuses?
- **Answer:** No. Provide another visual cue besides color.
- **Pitfall:** Users who differentiate without color may not be able to tell statuses apart.

## 15. Form controls

- **Question:** Do I need `LabeledContent` for the slider, or can I just put it in a stack?
- **Answer:** Use `LabeledContent` so the label and control are laid out correctly.
- **Pitfall:** Sliders in plain stacks often do not follow the best form layout pattern.
