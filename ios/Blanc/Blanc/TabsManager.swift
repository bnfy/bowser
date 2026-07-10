import Observation
import Foundation
import WebKit

@Observable
final class TabsManager {
    private(set) var tabs: [TabModel] = []
    var activeTabId: UUID?

    let normalizer = AddressNormalizer(searchEngine: BlancSettingsDefaults.searchEngine)

    @ObservationIgnored private let schemeHandler = BlancSchemeHandler()
    @ObservationIgnored private lazy var bridge = PagesBridge(manager: self)
    @ObservationIgnored private let contentBlocker = ContentBlocker()

    static let newTabURL = URL(string: "blanc://newtab/")!

    var activeTab: TabModel? {
        guard let activeTabId else { return nil }
        return tabs.first { $0.id == activeTabId }
    }

    var isAdBlockReady: Bool {
        contentBlocker.isReady
    }

    init() {
        if let loaded = ContentBlocker.loadBundledBlocklist() {
            contentBlocker.prepare(version: loaded.version, jsonProvider: loaded.loadJSON)
        }
        createTab()
    }

    @discardableResult
    func createTab(url: URL = TabsManager.newTabURL) -> UUID {
        let config = WebViewConfiguration.make(schemeHandler: schemeHandler, bridge: bridge)
        if let ruleList = contentBlocker.compiledRuleList {
            config.userContentController.add(ruleList)
        }
        let tab = TabModel(url: url, configuration: config)
        if !contentBlocker.isReady {
            contentBlocker.attach(to: tab.webView)
        }
        tabs.append(tab)
        activeTabId = tab.id
        return tab.id
    }

    func closeTab(_ id: UUID) {
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        let wasActive = id == activeTabId
        // If the tab is still queued for a cold-compile drain, drop it so its web view
        // isn't reloaded after it's gone (and isn't kept alive by the pending queue).
        contentBlocker.cancelPending(for: tabs[index].webView)
        tabs.remove(at: index)

        if tabs.isEmpty {
            createTab()
            return
        }

        if wasActive {
            let nextIndex = min(index, tabs.count - 1)
            activeTabId = tabs[nextIndex].id
        }
    }

    func setActive(_ id: UUID) {
        guard tabs.contains(where: { $0.id == id }) else { return }
        activeTabId = id
    }

    func submitActiveTabAddress() {
        activeTab?.submitAddress(using: normalizer)
    }
}
