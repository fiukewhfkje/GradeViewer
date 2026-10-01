import SwiftUI
import WebKit
import GradeCore
import WidgetKit

struct SettingsView: View {
    @Environment(AppStore.self) private var store
    @AppStorage("appearance") private var appearance = "system"
    @State private var disconnecting: ProviderID?
    var body: some View {
        Form {
            Section("Connections") {
                NavigationLink { SchoologySetupView() } label: { LabeledContent("Schoology", value: store.connected.contains(.schoology) ? "Connected" : "Connect") }
                NavigationLink { CampusSetupView() } label: { LabeledContent("Infinite Campus", value: store.connected.contains(.infiniteCampus) ? "Connected" : "Connect") }
                ForEach(ProviderID.allCases.filter { store.connected.contains($0) }, id: \.self) { provider in Button("Disconnect \(provider.name)", role: .destructive) { disconnecting = provider }.disabled(store.refreshing) }
            }
            Section {
                Picker("Appearance", selection: $appearance) { Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark") }
                Button("Reload widgets") { WidgetCenter.shared.reloadAllTimelines() }
            }
            Section {
                LabeledContent("Version", value: "1.0 (1)")
                Text("Grades stay on this device. Credentials are stored in Keychain.").font(.footnote).foregroundStyle(.secondary)
            }
        }.navigationTitle("Settings")
            .confirmationDialog("Disconnect \(disconnecting?.name ?? "account")?", isPresented: Binding(get: { disconnecting != nil }, set: { if !$0 { disconnecting = nil } }), titleVisibility: .visible) {
                Button("Disconnect and remove its saved grades", role: .destructive) { if let provider = disconnecting { store.disconnect(provider) }; disconnecting = nil }
            } message: { Text("Local grade history and What-If scenarios will be reset.") }
    }
}
struct SchoologySetupView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var key = ""
    @State private var secret = ""
    @State private var token = ""
    @State private var tokenSecret = ""
    @State private var saving = false
    @State private var error: String?
    var body: some View {
        Form {
            Section {
                TextField("Consumer key", text: $key).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("Consumer secret", text: $secret).textInputAutocapitalization(.never).autocorrectionDisabled()
            } header: { Text("API credentials") } footer: { Text("Use your personal Schoology API key and secret.") }
            DisclosureGroup("Access token (if required)") {
                SecureField("Token", text: $token).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("Token secret", text: $tokenSecret).textInputAutocapitalization(.never).autocorrectionDisabled()
            }
            if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
            ConnectionRetryView(provider: .schoology)
            Button {
                saving = true
                Task { defer { saving = false }; do { try await store.connectSchoology(SchoologyCredentials(key: key.trimmingCharacters(in: .whitespacesAndNewlines), secret: secret.trimmingCharacters(in: .whitespacesAndNewlines), token: token, tokenSecret: tokenSecret)); secret = ""; token = ""; tokenSecret = ""; dismiss() } catch { self.error = store.message(error, provider: .schoology) } }
            } label: { if saving { ProgressView() } else { Text("Connect") } }.disabled(key.isEmpty || secret.isEmpty || saving || store.refreshing || store.demo)
        }.navigationTitle("Schoology").navigationBarTitleDisplayMode(.inline)
    }
}
struct CampusSetupView: View {
    @Environment(AppStore.self) private var store
    @State private var portalURL = ""
    @State private var loginURL: URL?
    @State private var error: String?
    var validURL: URL? {
        guard let url = URL(string: portalURL.trimmingCharacters(in: .whitespacesAndNewlines)), (try? CampusSession(portal: url, cookies: [])) != nil else { return nil }; return url
    }
    var body: some View {
        Form {
            Section {
                TextField("Campus Student portal URL", text: $portalURL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            } footer: { Text("Paste your district’s Campus Student address. Sign in directly on its page.") }
            if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
            ConnectionRetryView(provider: .infiniteCampus)
            Button("Sign in to Infinite Campus") { loginURL = validURL }.disabled(validURL == nil || store.refreshing || store.demo)
            Button("Find your district") { loginURL = URL(string: "https://www.infinitecampus.com/login")! }.disabled(store.refreshing || store.demo)
        }.navigationTitle("Infinite Campus").navigationBarTitleDisplayMode(.inline)
            .onAppear { if let session = try? SecureStore.load(CampusSession.self, account: "campus") { portalURL = session.portal.absoluteString } }
            .sheet(isPresented: Binding(get: { loginURL != nil }, set: { if !$0 { loginURL = nil } })) { if let url = loginURL { CampusLoginView(portal: url) { loginURL = nil } } }
    }
}
@Observable @MainActor final class CampusWebSession {
    let webView: WKWebView
    var host = ""
    var studentPortal: URL?
    init(portal: URL) {
        let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        host = portal.host ?? ""
        if (try? CampusSession(portal: portal, cookies: [])) != nil { studentPortal = portal }
        // Restore this app's saved Campus cookies to the private login view.
        // The district can reuse a still-valid session through its normal page.
        let saved = try? SecureStore.load(CampusSession.self, account: "campus")
        let cookies = saved?.base.host?.lowercased() == portal.host?.lowercased() ? saved?.cookies.compactMap(\.cookie) ?? [] : []
        Task { @MainActor [webView] in
            for cookie in cookies where cookie.expiresDate.map({ $0 > Date() }) ?? true {
                await webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie)
            }
            webView.load(URLRequest(url: portal))
        }
    }
}
struct CampusLoginView: View {
    @Environment(AppStore.self) private var store
    let portal: URL; let finish: () -> Void
    @State private var session: CampusWebSession
    @State private var saving = false
    @State private var error: String?
    init(portal: URL, finish: @escaping () -> Void) { self.portal = portal; self.finish = finish; _session = State(initialValue: CampusWebSession(portal: portal)) }
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let error { Text(error).font(.footnote).foregroundStyle(.secondary).padding(10) }
                if let detail = store.connectionDetails[.infiniteCampus] { Text(detail).font(.caption).foregroundStyle(.secondary).padding(10) }
                CampusWebView(session: session)
            }.navigationTitle(session.host).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: finish).disabled(saving) }
                    ToolbarItem(placement: .confirmationAction) { Button("Connect") {
                        saving = true
                        Task { defer { saving = false }; do {
                            let cookies = await session.webView.configuration.websiteDataStore.httpCookieStore.allCookies()
                            guard let portal = session.studentPortal else { throw ProviderError.reconnect }
                            let saved = try CampusSession(portal: portal, cookies: cookies)
                            guard !saved.cookies.isEmpty else { throw ProviderError.reconnect }
                            try await store.connectCampus(saved); finish()
                        } catch { self.error = store.message(error, provider: .infiniteCampus) } }
                    }.disabled(saving || session.studentPortal == nil) }
                }
        }.interactiveDismissDisabled(saving)
    }
}
struct ConnectionRetryView: View {
    @Environment(AppStore.self) private var store
    let provider: ProviderID
    @State private var error: String?
    var body: some View {
        if let detail = store.connectionDetails[provider] { Text(detail).font(.caption).foregroundStyle(.secondary) }
        if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
        if store.pending.contains(provider) {
            Section {
                Button(provider == .schoology ? "Retry saved API credentials" : "Retry saved session") {
                    error = nil
                    Task { do { try await store.retryConnection(provider) } catch { self.error = store.message(error, provider: provider) } }
                }.disabled(store.refreshing || store.demo)
                Button("Forget saved connection", role: .destructive) { store.forgetPending(provider) }.disabled(store.refreshing)
            } footer: { Text("Stored in Keychain for retry. Grades load after the connection succeeds.") }
        } else if store.connected.contains(provider) { Text("Connected").foregroundStyle(.secondary) }
    }
}
struct CampusWebView: UIViewRepresentable {
    let session: CampusWebSession
    func makeCoordinator() -> Coordinator { Coordinator(session) }
    func makeUIView(context: Context) -> WKWebView { session.webView.navigationDelegate = context.coordinator; session.webView.uiDelegate = context.coordinator; return session.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let session: CampusWebSession
        init(_ session: CampusWebSession) { self.session = session }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { session.host = webView.url?.host ?? session.host }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url, url.scheme == "https" || url.absoluteString == "about:blank" else { decisionHandler(.cancel); return }
            if (try? CampusSession(portal: url, cookies: [])) != nil { session.studentPortal = url }
            decisionHandler(.allow)
        }
        // Handle SSO windows in the same nonpersistent view. Never read or inject login fields.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }; return nil }
    }
}
struct WidgetPreviewView: View {
    let courses: [Course]
    var body: some View {
        VStack(spacing: 24) {
            GradeWidgetContent(snapshot: WidgetSnapshot(courses: courses.prefix(3).map(WidgetCourse.init), refreshed: Demo.now), compact: false)
                .frame(width: 330, height: 150).padding(16).background(.background, in: RoundedRectangle(cornerRadius: 24))
            GradeWidgetContent(snapshot: WidgetSnapshot(courses: courses.prefix(1).map(WidgetCourse.init), refreshed: Demo.now), compact: true)
                .frame(width: 130, height: 130).padding(16).background(.background, in: RoundedRectangle(cornerRadius: 24))
        }.frame(maxWidth: .infinity, maxHeight: .infinity).background(Color(uiColor: .systemGroupedBackground)).navigationTitle("Widgets").navigationBarTitleDisplayMode(.inline)
    }
}
