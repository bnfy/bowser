import SwiftUI

struct PaletteSheet: View {
    let manager: TabsManager
    @Environment(\.dismiss) private var dismiss
    @State private var input = ""
    @FocusState private var inputFocused: Bool

    private enum Mode {
        case tabs, slash, switcher
    }

    private var mode: Mode {
        if input.isEmpty { return .tabs }
        if input.hasPrefix("/") { return .slash }
        return .switcher
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TextField("Search, enter address, or / for commands", text: $input)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.webSearch)
                    .submitLabel(.go)
                    .focused($inputFocused)
                    .onSubmit { handleSubmit() }
                    .padding()

                Divider()

                listContent
            }
            .navigationTitle("Blanc")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear { inputFocused = true }
    }

    @ViewBuilder
    private var listContent: some View {
        switch mode {
        case .tabs:
            tabList
        case .slash:
            slashList
        case .switcher:
            switcherList
        }
    }

    private var tabList: some View {
        List {
            ForEach(manager.tabs) { tab in
                Button {
                    manager.setActive(tab.id)
                    dismiss()
                } label: {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(tab.pageTitle.isEmpty ? "New Tab" : tab.pageTitle)
                                .lineLimit(1)
                            Text(tab.currentURL.absoluteString)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        if tab.id == manager.activeTabId {
                            Image(systemName: "checkmark")
                                .foregroundStyle(.tint)
                        }
                    }
                }
            }
            .onDelete { offsets in
                let ids = offsets.map { manager.tabs[$0].id }
                for id in ids { manager.closeTab(id) }
            }
        }
    }

    private var slashList: some View {
        let slashWord = String(input.trimmingCharacters(in: .whitespaces)
            .split(separator: " ").first ?? Substring(input))
        let matches = SlashCommand.filter(prefix: slashWord)
        return List {
            if matches.isEmpty {
                Text("No matching command")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(matches) { cmd in
                    Button {
                        cmd.execute(manager)
                        dismiss()
                    } label: {
                        VStack(alignment: .leading) {
                            Text(cmd.command)
                                .fontWeight(.medium)
                            Text(cmd.hint)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private var switcherList: some View {
        let results = QuickSwitcher.search(
            query: input.trimmingCharacters(in: .whitespacesAndNewlines),
            tabs: manager.tabs
        )
        return List {
            if results.isEmpty {
                Text("No matches — tap Go to open as address or search")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(results, id: \.tab.id) { result in
                    Button {
                        manager.setActive(result.tab.id)
                        dismiss()
                    } label: {
                        VStack(alignment: .leading) {
                            Text(result.title)
                                .lineLimit(1)
                            Text(result.subtitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
            }
        }
    }

    private func handleSubmit() {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        if trimmed.hasPrefix("/") {
            let slashWord = String(trimmed.split(separator: " ").first ?? Substring(trimmed))
            let matches = SlashCommand.filter(prefix: slashWord)
            if let first = matches.first {
                first.execute(manager)
                dismiss()
            }
            return
        }

        let results = QuickSwitcher.search(query: trimmed, tabs: manager.tabs)
        if let top = results.first, top.score >= QuickSwitcher.strongMatchScore {
            manager.setActive(top.tab.id)
            dismiss()
            return
        }

        manager.activeTab?.addressText = trimmed
        manager.submitActiveTabAddress()
        dismiss()
    }
}
