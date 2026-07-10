import Foundation
import Observation
import WebKit

protocol RuleListStoring {
    func lookupRuleList(
        forIdentifier identifier: String,
        found: @escaping (Bool) -> Void
    )
    func compileRuleList(
        forIdentifier identifier: String,
        encodedContentRuleList: String,
        completed: @escaping (Bool) -> Void
    )
}

protocol RuleListAttaching: AnyObject {
    func attachContentBlockingRules(from blocker: ContentBlocker)
}

extension WKWebView: RuleListAttaching {
    func attachContentBlockingRules(from blocker: ContentBlocker) {
        guard let ruleList = blocker.compiledRuleList else { return }
        configuration.userContentController.add(ruleList)
        reload()
    }
}

final class WKRuleListStoreAdapter: RuleListStoring {
    private let store = WKContentRuleListStore.default()
    weak var blocker: ContentBlocker?

    func lookupRuleList(
        forIdentifier identifier: String,
        found: @escaping (Bool) -> Void
    ) {
        store?.lookUpContentRuleList(forIdentifier: identifier) { [weak self] ruleList, _ in
            if let ruleList {
                self?.blocker?.compiledRuleList = ruleList
                found(true)
            } else {
                found(false)
            }
        }
    }

    func compileRuleList(
        forIdentifier identifier: String,
        encodedContentRuleList: String,
        completed: @escaping (Bool) -> Void
    ) {
        store?.compileContentRuleList(
            forIdentifier: identifier,
            encodedContentRuleList: encodedContentRuleList
        ) { [weak self] ruleList, error in
            if let ruleList {
                self?.blocker?.compiledRuleList = ruleList
                completed(true)
            } else {
                if let error { print("ContentBlocker compile error: \(error)") }
                completed(false)
            }
        }
    }
}

@Observable
final class ContentBlocker {
    /// A *weakly*-held queued attach target. Web views waiting on the cold-compile
    /// window must not be pinned by the blocker: a tab closed mid-compile has to be
    /// able to deallocate, and a terminal compile failure must not leak the whole
    /// queue for the app's lifetime.
    private struct WeakTarget {
        weak var target: RuleListAttaching?
    }

    var isReady = false

    @ObservationIgnored var compiledRuleList: WKContentRuleList?
    @ObservationIgnored private let store: RuleListStoring
    @ObservationIgnored private var pendingTargets: [WeakTarget] = []

    init(store: RuleListStoring = WKRuleListStoreAdapter()) {
        self.store = store
        if let adapter = store as? WKRuleListStoreAdapter {
            adapter.blocker = self
        }
    }

    /// Returns the blocklist version plus a *lazy* loader for the rule JSON.
    /// Only the tiny `blocklist.meta.json` is read eagerly; the multi-megabyte
    /// `blocklist.json` is read only if `prepare` misses the compiled cache, so
    /// a warm launch never pays a large synchronous file read on the main thread.
    static func loadBundledBlocklist(in bundle: Bundle = .main) -> (version: String, loadJSON: () -> String?)? {
        guard let generatedDir = bundle.resourceURL?.appendingPathComponent("generated") else { return nil }

        let metaURL = generatedDir.appendingPathComponent("blocklist.meta.json")
        guard let metaData = try? Data(contentsOf: metaURL),
              let meta = try? JSONSerialization.jsonObject(with: metaData) as? [String: Any],
              let version = meta["version"] as? String else { return nil }

        let jsonURL = generatedDir.appendingPathComponent("blocklist.json")
        return (version, { try? String(contentsOf: jsonURL, encoding: .utf8) })
    }

    func prepare(version: String, jsonProvider: @escaping () -> String?) {
        store.lookupRuleList(forIdentifier: version) { [weak self] found in
            guard let self else { return }
            if found {
                self.isReady = true
                self.drainPending()
            } else if let jsonString = jsonProvider() {
                self.compile(version: version, jsonString: jsonString)
            }
        }
    }

    func attach(to target: RuleListAttaching) {
        if isReady {
            target.attachContentBlockingRules(from: self)
        } else {
            pendingTargets.append(WeakTarget(target: target))
        }
    }

    /// Removes `target` from the pending queue — called when a tab closes during the
    /// compile window so its detached web view never receives a pointless add-rules +
    /// reload on drain. `closeTab` calls this with the web view still alive (before the
    /// tab is dropped), so an identity match is sufficient; `drainPending` separately
    /// skips any box whose target deallocated while queued.
    func cancelPending(for target: RuleListAttaching) {
        pendingTargets.removeAll { $0.target === target }
    }

    private func compile(version: String, jsonString: String) {
        store.compileRuleList(
            forIdentifier: version,
            encodedContentRuleList: jsonString
        ) { [weak self] success in
            guard let self else { return }
            guard success else {
                // Terminal failure: drop the queue so it can't leak for the app's lifetime.
                self.pendingTargets.removeAll()
                return
            }
            self.isReady = true
            self.drainPending()
        }
    }

    private func drainPending() {
        let boxes = pendingTargets
        pendingTargets.removeAll()
        for box in boxes {
            // Skip any target that deallocated while queued (e.g. a tab closed mid-compile).
            box.target?.attachContentBlockingRules(from: self)
        }
    }
}
