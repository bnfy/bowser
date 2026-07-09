import Foundation
import WebKit

/// Builds a `WKWebViewConfiguration` that serves `blanc://` from the bundle
/// and injects the `window.bowserPages` bridge. The handler and bridge are
/// shared (stateless / keyed off `message.webView`), so the same instances
/// are installed on every tab's configuration.
enum WebViewConfiguration {
    static func make(schemeHandler: BlancSchemeHandler, bridge: PagesBridge) -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(schemeHandler, forURLScheme: "blanc")

        let userScript = WKUserScript(
            source: PagesBridge.userScriptSource,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true)
        config.userContentController.addUserScript(userScript)
        config.userContentController.add(bridge, name: PagesBridge.messageHandlerName)
        return config
    }
}
