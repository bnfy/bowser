import Foundation

struct SlashCommand: Identifiable {
    var id: String { command }
    let command: String
    let hintKey: String
    let execute: (TabsManager) -> Void

    var hint: String {
        NSLocalizedString(hintKey, tableName: "SlashCommands", bundle: .main, comment: "")
    }

    static let available: [SlashCommand] = [
        SlashCommand(command: "/new", hintKey: "slash_new") { manager in
            manager.createTab()
        },
        SlashCommand(command: "/close", hintKey: "slash_close") { manager in
            if let id = manager.activeTabId {
                manager.closeTab(id)
            }
        },
    ]

    static func filter(prefix: String) -> [SlashCommand] {
        guard !prefix.isEmpty else { return available }
        return available.filter { $0.command.hasPrefix(prefix) }
    }
}
