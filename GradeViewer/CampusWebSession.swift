import SwiftUI
import WebKit
import GradeCore

/// Both interactive login and renewal use the district's normal browser flow.
/// Every browser store is memory-only; reusable cookies live in Keychain.
@Observable @MainActor final class CampusWebSession: NSObject, WKNavigationDelegate, WKUIDelegate {
    let webView: WKWebView
    var host = ""
    var studentPortal: URL?
    private(set) var loading = false
    private(set) var loadError: String?
    private(set) var pageLoaded = false
    var canConnect: Bool { studentPortal != nil && pageLoaded && !loading && loadError == nil }
    private var base: URL?
    private var entry: URL?
    private var idpHosts = Set<String>()
    private let saved: CampusSession?
    private let automatic: Bool
    @ObservationIgnored private var completion: CheckedContinuation<CampusSession, Error>?
    @ObservationIgnored private var deadline: Task<Void, Never>?
    @ObservationIgnored private var completed = false
    @ObservationIgnored private var stages: [String] = []
    private var visitedIdp = false
    @ObservationIgnored private var started = false
    @ObservationIgnored private var restoredCookies = false
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var loadDeadline: Task<Void, Never>?
    private let initialPortal: URL

    init(portal: URL, saved: CampusSession?, automatic: Bool = false) {
        let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        host = portal.host ?? ""
        let selected = try? CampusSession(portal: portal, cookies: [])
        base = selected?.base; studentPortal = selected?.portal
        self.saved = saved?.base == selected?.base ? saved : nil
        self.automatic = automatic; initialPortal = portal
        if let selected {
            if let sso = self.saved?.sso, CampusSSO.validEntry(sso.entry, base: selected.base) {
                entry = sso.entry; idpHosts = sso.hosts
            }
        }
        super.init()
        webView.navigationDelegate = self; webView.uiDelegate = self
    }

    // Start only when the retained SwiftUI session is presented. View initializers
    // can run repeatedly; starting there creates invisible SSO browsers on redraw.
    func start() {
        guard !started, !completed else { return }
        started = true
        load(entry ?? initialPortal)
    }
    func retry(usePortal: Bool = false) {
        guard !automatic, !completed else { return }
        load(usePortal ? initialPortal : (entry ?? initialPortal))
    }
    private func load(_ url: URL) {
        loadTask?.cancel(); webView.stopLoading()
        beginLoading()
        loadTask = Task { [weak self] in
            guard let self else { return }
            if !restoredCookies { await restoreCookies() }
            guard !completed, !Task.isCancelled, loadError == nil else { return }
            #if DEBUG
            // The UI fixture stays local, including after Retry is tapped.
            let arguments = ProcessInfo.processInfo.arguments
            if arguments.contains("--demo"), arguments.contains("--campus-browser-failure") { return }
            #endif
            webView.load(URLRequest(url: url))
        }
    }
    private func beginLoading() {
        loading = true; pageLoaded = false; loadError = nil
        guard !automatic else { return } // Renewal has one overall deadline.
        loadDeadline?.cancel()
        loadDeadline = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            self?.failed(URLError(.timedOut))
        }
    }
    func cancel() {
        loadTask?.cancel(); loadTask = nil
        loadDeadline?.cancel(); loadDeadline = nil
        if automatic { browserCancelled() }
        else {
            completed = true; loading = false
            webView.stopLoading(); webView.navigationDelegate = nil; webView.uiDelegate = nil
        }
    }
    func restoreCookies() async {
        let cookieStore = webView.configuration.websiteDataStore.httpCookieStore
        if let saved {
            // Revalidate decoded scopes before putting credentials into WebKit.
            let campus = try? CampusSession(portal: saved.portal, cookies: saved.cookies.compactMap(\.cookie))
            let cookies = (campus?.cookies.compactMap(\.cookie) ?? []) + (saved.sso?.browserCookies(base: saved.base) ?? [])
            for cookie in cookies {
                guard !Task.isCancelled, !completed else { return }
                await cookieStore.setCookie(cookie)
            }
        }
        restoredCookies = true
    }

    func capture() async throws -> CampusSession {
        guard let studentPortal else { throw ProviderError.reconnect }
        let cookies = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
        var session = try CampusSession(portal: studentPortal, cookies: cookies)
        if let entry, CampusSSO.validEntry(entry, base: session.base), !idpHosts.isEmpty {
            session.sso = try CampusSSO(base: session.base, entry: entry, hosts: idpHosts, cookies: cookies)
        }
        return session
    }

    static func renew(_ session: CampusSession, retainingCookies: ((CampusSession) -> Void)? = nil, diagnostics: (([String]) -> Void)? = nil) async throws -> CampusSession {
        guard session.sso?.canRenew(base: session.base) == true else { throw ProviderError.reconnect }
        let browser = CampusWebSession(portal: session.portal, saved: session, automatic: true)
        defer { diagnostics?(browser.stages) }
        do { return try await browser.run() }
        catch {
            // An IdP may rotate cookies before a later navigation fails. Keep
            // that rotation without replacing grades or treating TLS as logout.
            if browser.restoredCookies, let updated = try? await browser.capture() { retainingCookies?(updated) }
            throw error
        }
    }
    private func run() async throws -> CampusSession {
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                completion = continuation
                deadline = Task { [weak self] in
                    do { try await Task.sleep(for: .seconds(20)) } catch { return }
                    guard let self else { return }
                    // A finished login page needs the user; an unfinished load is a network timeout.
                    finish(.failure(loading ? URLError(.timedOut) : ProviderError.reconnect))
                }
                start()
            }
        } onCancel: {
            Task { @MainActor in self.browserCancelled() }
        }
    }
    private func browserCancelled() { finish(.failure(CancellationError())) }
    private func finish(_ result: Result<CampusSession, Error>) {
        guard !completed else { return }
        completed = true; loading = false
        deadline?.cancel(); deadline = nil; loadTask?.cancel(); loadTask = nil
        webView.stopLoading(); webView.navigationDelegate = nil; webView.uiDelegate = nil
        let pending = completion; completion = nil; pending?.resume(with: result)
    }

    /// Restrict automatic redirects to the Campus origin and previously used IdP hosts.
    func permits(_ url: URL) -> Bool {
        if url.absoluteString == "about:blank" { return true }
        guard url.scheme == "https", url.user == nil, url.password == nil,
              url.port == nil || url.port == 443, let host = url.host?.lowercased() else { return false }
        return !automatic || host == base?.host?.lowercased() || idpHosts.contains(host)
    }
    private func observe(_ url: URL) {
        guard let host = url.host?.lowercased(), url.scheme == "https" else { return }
        self.host = host
        if let selected = try? CampusSession(portal: url, cookies: []), base == nil || base == selected.base {
            base = selected.base; studentPortal = url
        }
        if let base, CampusSSO.validEntry(url, base: base) { entry = url }
        if entry != nil, host != base?.host?.lowercased() { visitedIdp = true }
        if !automatic, entry != nil, host != base?.host?.lowercased() { idpHosts.insert(host) }
    }
    private func record(_ action: String, url: URL?) {
        guard let url, stages.count < 50 else { return }
        let route: String
        if url.host?.lowercased() == base?.host?.lowercased() {
            route = CampusSSO.validEntry(url, base: base!) ? "Campus SSO" : ((try? CampusSession(portal: url, cookies: [])) != nil ? "Campus Student" : "Campus")
        } else if url.host == "accounts.google.com" {
            if url.path.contains("/signin/identifier") { route = "Google sign-in" }
            else if url.path.contains("/challenge") { route = "Google verification" }
            else if url.path.contains("/saml2") { route = "Google SAML" }
            else { route = "Google" }
        } else { route = "other HTTPS" }
        stages.append(action + ": " + route)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, permits(url) else {
            record("blocked", url: navigationAction.request.url)
            decisionHandler(.cancel)
            if automatic { finish(.failure(ProviderError.reconnect)) }
            else if navigationAction.targetFrame?.isMainFrame != false { failed(ProviderError.unsafeURL) }
            return
        }
        if navigationAction.targetFrame?.isMainFrame != false { observe(url); record("navigation", url: url) }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void) {
        guard let url = navigationResponse.response.url, permits(url) else {
            record("blocked response", url: navigationResponse.response.url)
            decisionHandler(.cancel)
            if automatic { finish(.failure(ProviderError.reconnect)) }
            else if navigationResponse.isForMainFrame { failed(ProviderError.unsafeURL) }
            return
        }
        if navigationResponse.isForMainFrame {
            observe(url); record("response", url: url)
            if let response = navigationResponse.response as? HTTPURLResponse, response.statusCode >= 400 {
                decisionHandler(.cancel)
                failed(response.statusCode == 429 ? ProviderError.throttled(ReadOnlyHTTP.retryAfter(response.value(forHTTPHeaderField: "Retry-After"))) : ProviderError.unavailable)
                return
            }
        }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { beginLoading() }
    func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!) {
        if let url = webView.url, permits(url) { observe(url); record("redirect", url: url) }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let url = webView.url else { return }
        observe(url)
        loading = false; pageLoaded = true; loadError = nil
        loadDeadline?.cancel(); loadDeadline = nil
        record("loaded", url: url)
        // A Campus return is only a candidate. The caller must verify the full grade fetch.
        // District SAML can finish on a shared Campus page rather than the
        // configured Student-home route. Keep the validated saved Student URL;
        // the full grade fetch decides whether this return actually authenticated.
        if automatic, let base, CampusSSO.returnedToCampus(url, base: base, visitedIdp: visitedIdp) {
            Task { do { finish(.success(try await capture())) } catch { finish(.failure(error)) } }
        }
    }
    private func failed(_ error: Error) {
        // A SAML form or popup can cancel the preceding navigation normally.
        let underlying = error as NSError
        guard underlying.domain != NSURLErrorDomain || underlying.code != NSURLErrorCancelled else { return }
        if automatic { finish(.failure(error)) }
        else {
            loading = false; pageLoaded = false
            loadError = Self.message(error)
            loadDeadline?.cancel(); loadDeadline = nil; loadTask?.cancel(); loadTask = nil
            webView.stopLoading()
        }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { failed(ProviderError.unavailable) }
    static func message(_ error: Error) -> String {
        if let error = error as? URLError {
            switch error.code {
            case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid:
                return "A secure connection to the sign-in page failed. Check your network or VPN, then retry. Your saved sign-in is retained."
            case .timedOut: return "The sign-in page took too long to load. Check your connection, then retry."
            case .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost:
                return "The sign-in page could not be reached. Check your connection, then retry."
            default: break
            }
        }
        if case ProviderError.unsafeURL = error { return "This sign-in link could not be opened securely. Try the student portal."
        }
        if case ProviderError.throttled = error { return "The sign-in service asked you to wait. Try again shortly." }
        return "The sign-in page could not load. Retry or open the student portal."
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url, permits(url) { observe(url); webView.load(navigationAction.request) }
        return nil
    }
}

struct CampusWebView: UIViewRepresentable {
    let session: CampusWebSession
    func makeUIView(context: Context) -> WKWebView { session.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
