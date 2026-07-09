import Foundation
import WebKit
import UIKit

final class TabNavigationDelegate: NSObject, WKNavigationDelegate {
    weak var tab: TabModel?
    private var lastRequested: URL?

    func load(_ url: URL, in webView: WKWebView) {
        guard url != lastRequested else { return }
        lastRequested = url
        webView.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView,
                 didStartProvisionalNavigation navigation: WKNavigation!) {
        tab?.isLoading = true
    }

    func webView(_ webView: WKWebView,
                 didFinish navigation: WKNavigation!) {
        sync(webView)
    }

    func webView(_ webView: WKWebView,
                 didFail navigation: WKNavigation!,
                 withError error: Error) {
        sync(webView)
    }

    func webView(_ webView: WKWebView,
                 didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        sync(webView)
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url,
           let scheme = url.scheme?.lowercased(),
           OSHandoff.schemes.contains(scheme) {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    private func sync(_ webView: WKWebView) {
        guard let tab else { return }
        tab.isLoading = webView.isLoading
        tab.canGoBack = webView.canGoBack
        tab.canGoForward = webView.canGoForward
        tab.pageTitle = webView.title ?? ""
        if let u = webView.url {
            lastRequested = u
            tab.currentURL = u
            tab.addressText = u.absoluteString
        }
    }
}
