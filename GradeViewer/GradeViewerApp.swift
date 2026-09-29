import SwiftUI

@main struct GradeViewerApp: App {
    @State private var store = AppStore()
    @AppStorage("appearance") private var appearance = "system"
    var body: some Scene {
        WindowGroup {
            RootView().environment(store)
                .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
                .task { await store.startup() }
        }
    }
}
