import SwiftUI

/// The goal notice in a Bot conversation. Opening it never touches the Bot; quoting it in the
/// main thread is how the user talks about it.
struct OutcomeUpdateCardView: View {
  @Environment(AppStore.self) private var store
  let card: OutcomeUpdateCard
  var onReply: () -> Void
  @State private var liveTitle: String?
  @State private var liveStage: String?

  private var stage: String { liveStage ?? card.stage }
  private var title: String { liveTitle ?? card.title }
  var body: some View {
    HStack(spacing: 0) {
      Button {
        Task { await store.deepLink(card.target.url) }
      } label: {
        HStack(spacing: 12) {
          Image(systemName: Self.symbol(stage)).font(.system(size: 17, weight: .medium))
            .foregroundStyle(stage == "attention" || stage == "failed" ? NativePalette.link : NativePalette.muted)
            .frame(width: 30, height: 30)
          VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
              Text("Goal"); Text("·"); Text(Self.label(stage))
            }.font(.system(size: 11, weight: .medium)).foregroundStyle(NativePalette.muted)
            Text(title).font(.system(size: 15, weight: .medium)).foregroundStyle(NativePalette.text)
              .lineLimit(2).multilineTextAlignment(.leading)
          }
          Spacer(minLength: 6)
          Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold))
            .foregroundStyle(NativePalette.faint)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(NativePalette.surface, in: RoundedRectangle(cornerRadius: 20))
        .contentShape(RoundedRectangle(cornerRadius: 20))
      }.buttonStyle(.plain)
        .contextMenu {
          Button("Reply", systemImage: "arrow.uturn.backward") {
            NativeHaptics.play(.light, source: "message.reply-action")
            onReply()
          }
        }
        .accessibilityLabel(Text("Goal notice")).accessibilityValue(Text(title))
        .accessibilityHint(Text("Open goal"))
        .accessibilityAction(named: Text("Reply")) { onReply() }
        .accessibilityIdentifier("outcome-update-card-" + card.outcomeId)
      Spacer(minLength: 44)
    }
    .task(id: card.outcomeId) {
      // The saved stage is only what was true when the notice was posted.
      guard let api = store.api, let detail = try? await api.outcomeDetail(id: card.outcomeId) else { return }
      liveTitle = detail.title
      liveStage = OutcomeUpdateCard.stage(forStatus: detail.status)
    }
  }

  static func symbol(_ stage: String) -> String {
    switch stage {
    case "attention": "exclamationmark.circle"
    case "running", "generating": "arrow.triangle.2.circlepath"
    case "review": "checkmark.seal"
    case "accepted": "checkmark.circle"
    case "failed": "xmark.octagon"
    case "cancelled": "xmark.circle"
    default: "scope"
    }
  }
  static func label(_ stage: String) -> LocalizedStringKey {
    switch stage {
    case "attention": "Needs attention"
    case "running", "generating": "Running"
    case "review": "Pending review"
    case "accepted": "Accepted"
    case "failed": "Failed"
    case "cancelled": "Cancelled"
    default: "Draft"
    }
  }
}
