import SwiftUI

struct ContentView: View {
    @State private var manager = TabsManager()
    @State private var showPalette = false

    var body: some View {
        ZStack(alignment: .bottom) {
            (Color(blancHex: BlancTokens.bg(.light)) ?? .white)
                .ignoresSafeArea()

            if let tab = manager.activeTab {
                WebView(tab: tab)
                    .id(tab.id)
                    .ignoresSafeArea(edges: .top)
            }

            addressPill
        }
        .sheet(isPresented: $showPalette) {
            PaletteSheet(manager: manager)
        }
    }

    private var addressPill: some View {
        HStack(spacing: 10) {
            Button { showPalette = true } label: {
                HStack(spacing: 8) {
                    tabDots

                    Text(displayDomain)
                        .lineLimit(1)
                        .foregroundStyle(.primary)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open palette")

            if manager.isAdBlockReady {
                Image(systemName: "shield.checkmark")
                    .foregroundStyle(.primary)
                    .font(.footnote)
                    .accessibilityLabel("Ad blocking active")
            }

            Spacer(minLength: 0)

            Button {
                if manager.activeTab?.isLoading == true {
                    manager.activeTab?.stop()
                } else {
                    manager.activeTab?.reload()
                }
            } label: {
                Image(systemName:
                    manager.activeTab?.isLoading == true ? "xmark" : "arrow.clockwise")
            }

            Button { manager.createTab() } label: {
                Image(systemName: "plus")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .modifier(PillStyle())
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private var displayDomain: String {
        guard let url = manager.activeTab?.currentURL else { return "New Tab" }
        if url.scheme == "blanc" {
            return url.host == "newtab" ? "New Tab" : (url.host ?? "New Tab")
        }
        return url.host ?? "New Tab"
    }

    private var tabDots: some View {
        let maxVisible = 3
        let overflow = manager.tabs.count > maxVisible
        let visible = overflow ? Array(manager.tabs.prefix(maxVisible - 1)) : manager.tabs
        let overflowCount = manager.tabs.count - visible.count

        return HStack(spacing: 6) {
            ForEach(visible) { tab in
                Circle()
                    .fill(tab.id == manager.activeTabId
                          ? Color.primary
                          : Color.secondary.opacity(0.4))
                    .frame(width: 7, height: 7)
            }
            if overflow {
                Text("+\(overflowCount)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct PillStyle: ViewModifier {
    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content.glassEffect(.regular.interactive(), in: .capsule)
        } else {
            content
                .background(Color(blancHex: BlancTokens.surfaceRaised(.light)) ?? .white)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(Color(blancHex: BlancTokens.border(.light)) ?? .gray))
        }
    }
}

#Preview { ContentView() }
