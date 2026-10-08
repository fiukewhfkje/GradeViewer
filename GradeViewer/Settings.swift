import SwiftUI
import GradeCore

struct SettingsView: View {
    @Environment(AppStore.self) private var store
    @AppStorage("appearance") private var appearance = "system"
    var body: some View {
        Form {
            Section("Connections") {
                NavigationLink { SchoologySetupView() } label: { LabeledContent("Schoology", value: store.errors[.schoology] != nil ? "Check connection" : (store.connected.contains(.schoology) ? "Connected" : "Connect")) }
            }
            Section {
                Picker("Appearance", selection: $appearance) { Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark") }
            }
        }.navigationTitle("Settings")
    }
}
struct SchoologySetupView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var key = ""
    @State private var secret = ""
    @State private var editing = false
    @State private var saving = false
    @State private var error: String?
    var body: some View {
        Form {
            ConnectionStatusView(provider: .schoology)
            if !store.connected.contains(.schoology) || editing {
                Section {
                    TextField("API key", text: $key).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("API secret", text: $secret).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Link("Get your API key", destination: URL(string: "https://app.schoology.com/api")!)
                }
                if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
                ConnectionRetryView(provider: .schoology)
                Button {
                    saving = true
                    Task {
                        defer { saving = false }
                        do {
                            try await store.connectSchoology(SchoologyCredentials(key: key.trimmingCharacters(in: .whitespacesAndNewlines), secret: secret.trimmingCharacters(in: .whitespacesAndNewlines)))
                            secret = ""; dismiss()
                        } catch { self.error = store.message(error, provider: .schoology) }
                    }
                } label: { if saving { ProgressView() } else { Text("Connect") } }
                    .disabled(key.isEmpty || secret.isEmpty || saving || store.refreshing || store.demo)
            } else {
                Button("Update sign-in") { editing = true }.disabled(store.refreshing || store.demo)
            }
            DisconnectConnectionView(provider: .schoology)
        }.navigationTitle("Schoology").navigationBarTitleDisplayMode(.inline)
            .onDisappear { secret = "" }
    }
}
struct ConnectionStatusView: View {
    @Environment(AppStore.self) private var store
    let provider: ProviderID
    var body: some View {
        if store.connected.contains(provider) {
            Section {
                LabeledContent("Status", value: store.errors[provider] == nil ? "Connected" : "Check connection")
                    .accessibilityElement(children: .ignore).accessibilityLabel("Status")
                    .accessibilityValue(store.errors[provider] == nil ? "Connected" : "Check connection")
                    .accessibilityIdentifier("connection-status")
                if let error = store.errors[provider] { Text(error).font(.footnote).foregroundStyle(.secondary) }
            }
        }
    }
}
struct DisconnectConnectionView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let provider: ProviderID
    @State private var confirming = false
    var body: some View {
        if store.connected.contains(provider) {
            Section {
                Button("Disconnect", role: .destructive) { confirming = true }.disabled(store.refreshing)
            }.confirmationDialog("Disconnect \(provider.name)?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Disconnect and remove its saved grades", role: .destructive) {
                    store.disconnect(provider)
                    if !store.connected.contains(provider) { dismiss() }
                }
            } message: { Text("Local grade history and What-If scenarios will be reset.") }
        }
    }
}
struct ConnectionRetryView: View {
    @Environment(AppStore.self) private var store
    let provider: ProviderID
    @State private var error: String?
    var body: some View {
        if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
        if store.pending.contains(provider) {
            Section {
                Button("Retry sign-in") {
                    error = nil
                    Task { do { try await store.retryConnection(provider) } catch { self.error = store.message(error, provider: provider) } }
                }.disabled(store.refreshing || store.demo)
                Button("Clear saved sign-in", role: .destructive) { store.forgetPending(provider) }.disabled(store.refreshing)
            }
        }
    }
}
