import Foundation

struct AddressNormalizer {
    let searchEngine: BlancSearchEngine

    private static let queryAllowed: CharacterSet = {
        var s = CharacterSet()
        s.insert(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
        return s
    }()

    func searchURL(for query: String) -> URL {
        let q = query.addingPercentEncoding(withAllowedCharacters: Self.queryAllowed) ?? query
        let base: String
        switch searchEngine {
        case .duckduckgo: base = "https://duckduckgo.com/?q=\(q)"
        case .google:     base = "https://www.google.com/search?q=\(q)"
        case .bing:       base = "https://www.bing.com/search?q=\(q)"
        case .brave:      base = "https://search.brave.com/search?q=\(q)"
        }
        return URL(string: base)!
    }

    func normalize(_ input: String) -> URL {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)

        if let scheme = schemePrefix(of: trimmed) {
            if ["javascript", "data", "vbscript"].contains(scheme) {
                return searchURL(for: trimmed)
            }
            return URL(string: trimmed) ?? searchURL(for: trimmed)
        }
        if matches(trimmed, #"^localhost(:\d+)?(/|$)"#) {
            return URL(string: "http://\(trimmed)") ?? searchURL(for: trimmed)
        }
        if matches(trimmed, #"^(\d{1,3}\.){3}\d{1,3}(:\d+)?(/|$)"#) {
            return URL(string: "http://\(trimmed)") ?? searchURL(for: trimmed)
        }
        if matches(trimmed, #"^[^\s]+\.[a-zA-Z]{2,}(/[^\s]*)?$"#) {
            return URL(string: "https://\(trimmed)") ?? searchURL(for: trimmed)
        }
        return searchURL(for: trimmed)
    }

    private func schemePrefix(of s: String) -> String? {
        guard let r = s.range(of: "://") else { return nil }
        let prefix = String(s[s.startIndex..<r.lowerBound])
        guard matches(prefix, #"^[a-zA-Z][a-zA-Z0-9+.\-]*$"#) else { return nil }
        return prefix.lowercased()
    }

    private func matches(_ s: String, _ pattern: String) -> Bool {
        s.range(of: pattern, options: .regularExpression) != nil
    }
}
