import Foundation
import WebKit

/// Pure path→file decision logic for the `blanc://` scheme, mirroring the
/// desktop `pages.js` model: a known-host allowlist, `path.basename`
/// reduction, a charset allowlist, and a flat serving directory. No I/O —
/// unit-testable without a bundle or a web view.
enum BlancPageResolver {
    /// Hosts that map to a bundled `<host>.html`. `auth` is intentionally
    /// excluded (basic-auth is native on iOS, M12).
    static let knownPages: Set<String> = [
        "newtab", "bookmarks", "history", "downloads", "settings", "error", "shortcuts",
    ]

    private static let filenamePattern = try! NSRegularExpression(pattern: "^[\\w.-]+$")

    /// The flat filename to serve within the bundled `pages/` folder, or
    /// `nil` to reject the request. Traversal is defeated by taking the
    /// basename: `../../etc/passwd` collapses to `passwd`, which then simply
    /// isn't a bundled asset and 404s at serve time.
    static func resolvedFilename(host: String, path: String) -> String? {
        guard knownPages.contains(host) else { return nil }
        if path.isEmpty || path == "/" { return "\(host).html" }
        let basename = (path as NSString).lastPathComponent
        guard !basename.isEmpty else { return nil }
        let range = NSRange(basename.startIndex..., in: basename)
        guard filenamePattern.firstMatch(in: basename, range: range) != nil else { return nil }
        return basename
    }

    /// MIME type by extension, defaulting to octet-stream for anything the
    /// bundle doesn't use.
    static func mimeType(forFilename filename: String) -> String {
        switch (filename as NSString).pathExtension.lowercased() {
        case "html": return "text/html"
        case "css": return "text/css"
        case "js": return "text/javascript"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "json": return "application/json"
        default: return "application/octet-stream"
        }
    }
}

/// Serves the shared web bundle over `blanc://`. Stateless — one instance is
/// safe to install on every tab's configuration.
final class BlancSchemeHandler: NSObject, WKURLSchemeHandler {
    /// The bundled folder-reference name (`src/renderer/pages` copies in as `pages`).
    private static let bundleSubdirectory = "pages"

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let request = urlSchemeTask.request
        guard let url = request.url,
              let host = url.host,
              let filename = BlancPageResolver.resolvedFilename(host: host, path: url.path),
              let fileURL = Bundle.main.url(
                  forResource: (filename as NSString).deletingPathExtension,
                  withExtension: (filename as NSString).pathExtension,
                  subdirectory: Self.bundleSubdirectory),
              let data = try? Data(contentsOf: fileURL)
        else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": BlancPageResolver.mimeType(forFilename: filename)])!
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // No async work to cancel — serving is synchronous.
    }
}
