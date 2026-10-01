import SwiftUI

@main struct GradeViewerApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @State private var store = AppStore()
    @AppStorage("appearance") private var appearance = "system"
    var body: some Scene {
        WindowGroup {
            RootView().environment(store)
                .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
                .onChange(of: scenePhase) { _, phase in
                    if phase != .active { store.requireFreshData() }
                }
                .task(id: scenePhase) {
                    guard scenePhase == .active else { return }
                    await store.becameActive()
                    await store.refreshWhileActive()
                }
        }
    }
}
