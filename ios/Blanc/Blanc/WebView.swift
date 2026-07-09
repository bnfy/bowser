import SwiftUI
import WebKit

struct WebView: UIViewRepresentable {
    let tab: TabModel

    func makeUIView(context: Context) -> WKWebView {
        tab.webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
