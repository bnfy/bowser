import UIKit

enum OSHandoff {
    static let schemes: Set<String> = ["mailto", "tel", "facetime", "sms"]

    static func isHandoff(_ text: String) -> Bool {
        guard let scheme = URL(string: text)?.scheme?.lowercased() else { return false }
        return schemes.contains(scheme)
    }

    static func open(_ text: String) {
        guard let url = URL(string: text) else { return }
        UIApplication.shared.open(url)
    }
}
