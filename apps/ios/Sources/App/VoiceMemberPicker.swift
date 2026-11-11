import SwiftUI

/// Choose who is on a group call and who answers when nobody is named. Everyone starts selected and
/// the first member is the default speaker, as on the desktop.
struct VoiceMemberPicker: View {
  let members: [Bot]
  let onStart: ([String], String?) -> Void
  let onCancel: () -> Void
  @State private var selected: Set<String>
  @State private var speaker: String?

  init(members: [Bot], onStart: @escaping ([String], String?) -> Void, onCancel: @escaping () -> Void) {
    self.members = members
    self.onStart = onStart
    self.onCancel = onCancel
    _selected = State(initialValue: Set(members.map(\.id)))
    _speaker = State(initialValue: members.first?.id)
  }

  /// Members in room order, so the call lists them the way the group does.
  private var chosen: [String] { members.map(\.id).filter { selected.contains($0) } }
  /// The default speaker must be on the call; if they were unselected, the first remaining member takes over.
  private var effectiveSpeaker: String? {
    if let speaker, selected.contains(speaker) { return speaker }
    return chosen.first
  }

  var body: some View {
    NavigationStack {
      List {
        Section {
          ForEach(members) { member in
            HStack(spacing: 12) {
              Button {
                if selected.contains(member.id) { selected.remove(member.id) } else { selected.insert(member.id) }
              } label: {
                Image(systemName: selected.contains(member.id) ? "checkmark.circle.fill" : "circle")
                  .font(.system(size: 22))
                  .foregroundStyle(selected.contains(member.id) ? NativePalette.link : NativePalette.muted)
              }
              .buttonStyle(.plain)
              .accessibilityLabel(member.title.isEmpty ? member.name : member.title)
              .accessibilityValue(selected.contains(member.id) ? "Selected" : "Not selected")
              BotGlyph(color: Color(hex: member.color), kind: member.icon, size: 34, mode: .still)
                .frame(width: 34, height: 34)
                .clipShape(Circle())
              Text(member.title.isEmpty ? member.name : member.title)
                .foregroundStyle(NativePalette.text)
                .lineLimit(1)
              Spacer(minLength: 8)
              Button {
                speaker = member.id
              } label: {
                Text(member.id == effectiveSpeaker ? "Host" : "Make host")
                  .font(.caption.weight(.medium))
                  .padding(.horizontal, 10).padding(.vertical, 5)
                  .background(
                    member.id == effectiveSpeaker ? NativePalette.link.opacity(0.14) : NativePalette.surface,
                    in: Capsule()
                  )
                  .foregroundStyle(member.id == effectiveSpeaker ? NativePalette.link : NativePalette.muted)
              }
              .buttonStyle(.plain)
              .disabled(!selected.contains(member.id))
              .opacity(selected.contains(member.id) ? 1 : 0.4)
            }
            .accessibilityIdentifier("live-voice-member-\(member.id)")
          }
        } footer: {
          Text("Choose who can answer. The host answers when nobody is named.")
        }
      }
      .navigationTitle("Voice participants")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
        ToolbarItem(placement: .confirmationAction) {
          Button("Start group call") { onStart(chosen, effectiveSpeaker) }
            .disabled(chosen.isEmpty)
            .accessibilityIdentifier("live-voice-start-group")
        }
      }
    }
  }
}
