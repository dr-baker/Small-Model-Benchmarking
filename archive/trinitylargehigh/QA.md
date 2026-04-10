# SwiftUI QA - Common Issues and Pitfalls

## Question 1
**Question:** "I'm trying to create a Text view with red color and a custom font. The documentation says I can use `foregroundColor(.red)` and `font(.custom("Helvetica", size: 16))`. But the text doesn't look right. Am I missing something about how these modifiers work? Should I apply them in a specific order?"

**Answer:** 
- Use `foregroundStyle(.red)` instead of `foregroundColor(.red)` - `foregroundColor()` is deprecated in iOS 26+.
- Apply modifiers in the correct order: font first, then foregroundStyle. The recommended order is: `font(...).foregroundStyle(...)`.
- Example:
  ```swift
  Text("Hello")
      .font(.custom("Helvetica", size: 16))
      .foregroundStyle(.red)
  ```

**Pitfall:** Using deprecated API (`foregroundColor`) and not understanding modifier order can lead to rendering issues and maintenance problems.

## Question 2
**Question:** "I need to navigate between different form sections. I'm using `UINavigationController` and pushing view controllers, but it doesn't feel very SwiftUI-like. The docs mention `NavigationStack`, but I'm not sure how to use it properly. Can I still use UIKit navigation with SwiftUI views?"

**Answer:** 
- Use `NavigationStack` for hierarchical navigation in SwiftUI. It's the modern, SwiftUI-native approach.
- Do not mix UIKit navigation controllers with SwiftUI views unless you have a specific need for UIKit interoperability.
- Example:
  ```swift
  NavigationStack {
      Form {
          // form content
      }
      .navigationTitle("My Form")
  }
  ```

**Pitfall:** Using UIKit navigation in SwiftUI breaks the declarative nature of SwiftUI and can cause integration issues and inconsistent behavior.

## Question 3
**Question:** "I have a TextField that needs to update my data model. I'm using `Binding(get:set:)` to manually synchronize the values. Is this the right approach? The model updates, but sometimes the UI doesn't refresh properly. Should I be using `@State` instead?"

**Answer:** 
- Avoid manual `Binding(get:set:)` in view bodies. Use `@State` for local view state or `@StateObject`/`@ObservedObject` for shared view models.
- If you need to bind to an external model, use `@Binding` or `@ObservedObject` with `@Published` properties.
- Example with `@StateObject`:
  ```swift
  @StateObject private var model = FormModel()
  
  var body: some View {
      TextField("Username", text: $model.username)
  }
  ```

**Pitfall:** Manual bindings are error-prone, hard to maintain, and can cause UI update issues due to improper change notification.

## Question 4
**Question:** "I'm creating a list with navigation, but the list looks plain. I tried adding `listStyle(.grouped)` but it doesn't seem to work. Also, when I navigate to detail views, the back button text doesn't show the correct title. How do I fix the navigation bar appearance?"

**Answer:** 
- Use `.navigationTitle()` on the destination view to set the navigation bar title.
- For grouped lists, use `.listStyle(.grouped)` on the list itself, not the navigation stack.
- For back button titles, ensure the destination view has a proper `.navigationTitle()`.
- Example:
  ```swift
  NavigationStack {
      List {
          // list items
      }
      .listStyle(.grouped)
      
      Text("Detail View")
          .navigationTitle("Details")
  }
  ```

**Pitfall:** Misunderstanding how navigation titles and list styles work can lead to poor UI and confusing navigation experiences.

## Question 5
**Question:** "I'm trying to load images from URLs asynchronously. I'm using `Task` inside the view body to fetch the image data. But the view rebuilds constantly and the images flash. Also, I'm not sure how to handle cancellation when the view disappears. Is there a better way to do async image loading in SwiftUI?"

**Answer:** 
- Do not create a new `Task` in the view body for each update. Use an `ObservableObject` view model to manage async image loading.
- Use `Task` with proper cancellation handling, or better yet, use a dedicated image loading library like `Kingfisher` or `SDWebImageSwiftUI`.
- Example with view model:
  ```swift
  class ImageLoader: ObservableObject {
      @Published var image: Image?
      private var task: Task<Void, Never>?
      
      func load(url: URL) {
          task = Task {
              do {
                  let data = try await URLSession.shared.data(from: url)
                  let uiImage = UIImage(data: data)
                  DispatchQueue.main.async {
                      self.image = Image(uiImage: uiImage!)
                  }
              } catch {
                  print("Failed to load image")
              }
          }
      }
      
      func cancel() {
          task?.cancel()
      }
  }
  ```

**Pitfall:** Creating tasks in the view body causes excessive work, memory leaks, and poor performance due to lack of proper cancellation.

## Question 6
**Question:** "I made a button with just an SF Symbol icon. It looks clean, but I heard something about VoiceOver. Do I need to add a label? If so, how do I add it without cluttering the UI? Can't VoiceOver just read the icon name?"

**Answer:** 
- Yes, you must add an accessibility label to icon-only buttons. VoiceOver cannot infer meaning from icons alone.
- Use `.accessibilityLabel()` to provide a descriptive label without cluttering the visual UI.
- Example:
  ```swift
  Button(action: addUser) {
      Image(systemName: "plus")
  }
  .accessibilityLabel("Add User")
  ```

**Pitfall:** Icon-only buttons are completely inaccessible to VoiceOver users, violating accessibility guidelines and potentially excluding users with visual impairments.

## Question 7
**Question:** "I have a view model marked with `@ObservedObject`, but when I update properties, the UI doesn't always refresh. I'm using `@Published` on my model properties. Do I need to manually call `objectWillChange.send()`? Also, should I be using `@StateObject` instead?"

**Answer:** 
- Use `@StateObject` for view models created within the view, and `@ObservedObject` for view models passed from outside.
- `@Published` should automatically trigger UI updates, but ensure your model conforms to `ObservableObject` properly.
- If you need fine-grained control, you can call `objectWillChange.send()` before mutating properties.
- Example:
  ```swift
  class FormModel: ObservableObject {
      @Published var username: String = ""
      // No need to manually send objectWillChange with @Published
  }
  
  struct ContentView: View {
      @StateObject private var model = FormModel() // Use @StateObject for creation
      // ...
  }
  ```

**Pitfall:** Confusing `@StateObject` with `@ObservedObject` can lead to memory leaks or UI not updating properly. Misunderstanding `@Published` can cause unnecessary manual work.

## Question 8
**Question:** "I want to animate a view when a state changes. I wrapped the state variable with `.animation(.easeInOut)` but the animation is too sensitive - it animates on every tiny change. How can I control which changes trigger animation?"

**Answer:** 
- `.animation()` applies to all changes of the view's state. To control animation, use explicit animation blocks or conditional modifiers.
- Better approaches: use `withAnimation` for specific changes, or use `transaction` modifiers.
- Example with `withAnimation`:
  ```swift
  var body: some View {
      Circle()
          .fill(model.color)
          .onChange(of: model.color) { newColor in
              withAnimation(.easeInOut) {
                  // Only animate this specific change
              }
          }
  }
  ```

**Pitfall:** Using implicit animations on entire views causes unwanted animations and can lead to performance issues and confusing user experiences.