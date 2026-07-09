import Foundation

struct SwitcherResult {
    let tab: TabModel
    let score: Double
    let index: Int
    let title: String
    let subtitle: String
}

enum QuickSwitcher {
    static let strongMatchScore: Double = 2.0

    static func search(query: String, tabs: [TabModel]) -> [SwitcherResult] {
        let q = query.lowercased()
        guard !q.isEmpty else { return [] }

        var results: [SwitcherResult] = []
        var seen = Set<UUID>()

        for (index, tab) in tabs.enumerated() {
            guard !seen.contains(tab.id) else { continue }
            let text = matchableText(title: tab.pageTitle, url: tab.currentURL)
            let s = matchScore(query: q, text: text)
            guard s > 0 else { continue }
            seen.insert(tab.id)
            results.append(SwitcherResult(
                tab: tab,
                score: s + 0.2,
                index: index,
                title: tab.pageTitle.isEmpty ? "New Tab" : tab.pageTitle,
                subtitle: tab.currentURL.host ?? tab.currentURL.absoluteString
            ))
        }

        return Array(results
            .sorted { $0.score != $1.score ? $0.score > $1.score : $0.index < $1.index }
            .prefix(6))
    }

    private static func matchScore(query: String, text: String) -> Double {
        let t = text.lowercased()
        if t.contains(query) { return 2 }
        var qi = query.startIndex
        for ch in t {
            if ch == query[qi] {
                qi = query.index(after: qi)
                if qi == query.endIndex { return 1 }
            }
        }
        return 0
    }

    private static func matchableText(title: String, url: URL) -> String {
        let host = url.host ?? ""
        let path = String(url.path.prefix(64))
        return "\(title) \(host)\(path)"
    }
}
