# SwiftUI Common Issues Scenarios

## Scenario 1: Basic View with Text Styling

**Situation:** A developer is creating a simple view with styled text and wants to set text color and font.

**Question from a "stupid" AI with Swift docs access:**
```
"I'm trying to create a Text view with red color and a custom font. The documentation says I can use `foregroundColor(.red)` and `font(.custom("Helvetica", size: 16))`. But the text doesn't look right. Am I missing something about how these modifiers work? Should I apply them in a specific order?"
```

**What's wrong:** The AI is using `foregroundColor()` (deprecated) instead of `foregroundStyle()`, and might not realize that modifier order matters or that font should be applied before foregroundStyle for proper rendering.

## Scenario 2: Navigation in a Form

**Situation:** Building a multi-screen form that navigates between different sections.

**Question:**
```
"I need to navigate between different form sections. I'm using `UINavigationController` and pushing view controllers, but it doesn't feel very SwiftUI-like. The docs mention `NavigationStack`, but I'm not sure how to use it properly. Can I still use UIKit navigation with SwiftUI views?"
```

**What's wrong:** The AI is reaching for UIKit navigation instead of using modern SwiftUI navigation APIs like `NavigationStack` or `NavigationSplitView`.

## Scenario 3: Two-Way Binding in a Form

**Situation:** Creating a form with text fields that need to update a data model.

**Question:**
```
"I have a TextField that needs to update my data model. I'm using `Binding(get:set:)` to manually synchronize the values. Is this the right approach? The model updates, but sometimes the UI doesn't refresh properly. Should I be using `@State` instead?"
```

**What's wrong:** The AI is using manual `Binding(get:set:)` in the view body instead of using `@State` or proper property wrappers, leading to synchronization issues.

## Scenario 4: List with Navigation

**Situation:** Displaying a list of items that can be tapped to navigate to detail views.

**Question:**
```
"I'm creating a list with navigation, but the list looks plain. I tried adding `listStyle(.grouped)` but it doesn't seem to work. Also, when I navigate to detail views, the back button text doesn't show the correct title. How do I fix the navigation bar appearance?"
```

**What's wrong:** The AI might be using outdated list styles or not understanding how navigation titles and back buttons work in `NavigationStack`.

## Scenario 5: Loading Images from URL

**Situation:** Asynchronously loading images from the web in a list.

**Question:**
```
"I'm trying to load images from URLs asynchronously. I'm using `Task` inside the view body to fetch the image data. But the view rebuilds constantly and the images flash. Also, I'm not sure how to handle cancellation when the view disappears. Is there a better way to do async image loading in SwiftUI?"
```

**What's wrong:** The AI is creating a new `Task` for each view update, causing excessive work and not properly handling task lifecycle or cancellation.

## Scenario 6: Accessibility Issues

**Situation:** Creating a button with only an icon for accessibility.

**Question:**
```
"I made a button with just an SF Symbol icon. It looks clean, but I heard something about VoiceOver. Do I need to add a label? If so, how do I add it without cluttering the UI? Can't VoiceOver just read the icon name?"
```

**What's wrong:** The AI doesn't understand that icon-only buttons are inaccessible and that explicit labels are required for VoiceOver.

## Scenario 7: State Management with Observable Objects

**Situation:** Sharing data between multiple views using `@ObservedObject`.

**Question:**
```
"I have a view model marked with `@ObservedObject`, but when I update properties, the UI doesn't always refresh. I'm using `@Published` on my model properties. Do I need to manually call `objectWillChange.send()`? Also, should I be using `@StateObject` instead?"
```

**What's wrong:** The AI is confused about when to use `@StateObject` vs `@ObservedObject`, and might not be properly publishing changes.

## Scenario 8: Animation Usage

**Situation:** Adding implicit animations to a view.

**Question:**
```
"I want to animate a view when a state changes. I wrapped the state variable with `.animation(.easeInOut)` but the animation is too sensitive - it animates on every tiny change. How can I control which changes trigger animation?"
```

**What's wrong:** The AI is using implicit animations incorrectly, not understanding that `.animation()` on a view applies to all changes to that view's state.