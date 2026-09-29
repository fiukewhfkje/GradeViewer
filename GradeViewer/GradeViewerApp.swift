import SwiftUI

@main struct GradeViewerApp: App {
    @State private var store = AppStore()
    @AppStorage("appearance") private var appearance = "system"
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            RootView().environment(store)
                .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
                .task { await store.refresh() }
                .onChange(of: scenePhase) { _, value in if value == .active { Task { await store.refresh() } } }
        }
    }
}
