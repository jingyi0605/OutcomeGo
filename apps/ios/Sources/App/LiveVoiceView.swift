import SwiftUI

public struct LiveVoiceView: View {
  @ObservedObject private var session: LiveVoiceSession
  private let bot: Bot?
  private let participants: [Bot]
  private let defaultSpeakerID: String?
  private let onStop: () -> Void
  private let onMuteMicrophone: (Bool) -> Void
  private let onMuteSpeaker: (Bool) -> Void
  @State private var expanded = true
  @State private var microphoneMuted = false
  @State private var speakerMuted = false
  @State private var startedAt: Date?
  @State private var elapsedSeconds = 0

  public init(
    session: LiveVoiceSession,
    bot: Bot?,
    participants: [Bot] = [],
    defaultSpeakerID: String? = nil,
    onStop: @escaping () -> Void,
    onMuteMicrophone: @escaping (Bool) -> Void = { _ in },
    onMuteSpeaker: @escaping (Bool) -> Void = { _ in }
  ) {
    self.session = session
    self.bot = bot
    self.participants = participants
    self.defaultSpeakerID = defaultSpeakerID
    self.onStop = onStop
    self.onMuteMicrophone = onMuteMicrophone
    self.onMuteSpeaker = onMuteSpeaker
  }

  public var body: some View {
    Group {
      if expanded {
        Color.clear
          .frame(height: 1)
          .fullScreenCover(isPresented: $expanded) {
            LiveVoiceCallSurface(
              session: session,
              bot: bot,
              participants: participants,
              defaultSpeakerID: defaultSpeakerID,
              elapsedSeconds: elapsedSeconds,
              microphoneMuted: microphoneMuted,
              speakerMuted: speakerMuted,
              onMinimize: { expanded = false },
              onStop: onStop,
              onMuteMicrophone: toggleMicrophone,
              onMuteSpeaker: toggleSpeaker
            )
            .interactiveDismissDisabled(true)
          }
      } else {
        LiveVoiceMiniPill(
          session: session,
          bot: participants.first { $0.id == session.snapshot.speakerBotID } ?? bot ?? participants.first,
          elapsedSeconds: elapsedSeconds,
          onRestore: { expanded = true },
          onStop: onStop
        )
      }
    }
    .onAppear { startClockIfNeeded() }
    .onChange(of: session.snapshot.state) { _, _ in startClockIfNeeded() }
    .task {
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(1))
        if let startedAt {
          elapsedSeconds = max(0, Int(Date().timeIntervalSince(startedAt)))
        }
      }
    }
  }

  private func startClockIfNeeded() {
    guard startedAt == nil else { return }
    switch session.snapshot.state {
    case .disconnected, .ended:
      return
    default:
      startedAt = Date()
    }
  }

  private func toggleMicrophone() {
    microphoneMuted.toggle()
    onMuteMicrophone(microphoneMuted)
  }

  private func toggleSpeaker() {
    speakerMuted.toggle()
    onMuteSpeaker(speakerMuted)
  }
}

private struct LiveVoiceCallSurface: View {
  @ObservedObject var session: LiveVoiceSession
  let bot: Bot?
  let participants: [Bot]
  let defaultSpeakerID: String?
  let elapsedSeconds: Int
  let microphoneMuted: Bool
  let speakerMuted: Bool
  let onMinimize: () -> Void
  let onStop: () -> Void
  let onMuteMicrophone: () -> Void
  let onMuteSpeaker: () -> Void
  @State private var animateAvatar = false

  var body: some View {
    ZStack {
      NativePalette.background.ignoresSafeArea()
      VStack(spacing: 0) {
        HStack {
          Spacer()
          Button(action: onMinimize) {
            Image(systemName: "arrow.down.right.and.arrow.up.left")
              .font(.system(size: 17, weight: .semibold))
              .foregroundStyle(NativePalette.muted)
              .frame(width: 44, height: 44)
          }
          .accessibilityLabel("Minimize realtime voice")
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)

        Text("REALTIME CONVERSATION")
          .font(.system(size: 14, weight: .bold, design: .rounded))
          .tracking(2.2)
          .foregroundStyle(NativePalette.muted)
          .padding(.top, 4)

        Text(participants.isEmpty ? (bot?.title ?? bot?.name ?? "Talk with your assistant") : "Group voice conversation")
          .font(.system(size: 23, weight: .medium, design: .rounded))
          .foregroundStyle(NativePalette.text)
          .lineLimit(1)
          .padding(.horizontal, 28)
          .padding(.top, 10)

        Text(String(format: "%02d:%02d", elapsedSeconds / 60, elapsedSeconds % 60))
          .font(.system(size: 28, weight: .regular, design: .rounded))
          .foregroundStyle(NativePalette.muted)
          .monospacedDigit()
          .padding(.top, 4)

        Spacer(minLength: 12)

        if participants.isEmpty {
          VoiceAvatar(
            bot: bot,
            speaking: session.snapshot.state == .speaking,
            animate: animateAvatar
          )
          .frame(width: 190, height: 190)
          .onAppear { animateAvatar = true }
        } else {
          ParticipantStage(
            participants: participants,
            defaultSpeakerID: defaultSpeakerID,
            speakerBotID: session.snapshot.speakerBotID,
            userSpeaking: session.snapshot.userSpeaking,
            microphoneMuted: microphoneMuted
          )
          .padding(.horizontal, 20)
          .onAppear { animateAvatar = true }
        }

        HStack(spacing: 9) {
          Circle()
            .fill(statusColor)
            .frame(width: 10, height: 10)
          Text(statusText)
            .font(.system(size: 20, weight: .regular, design: .rounded))
            .foregroundStyle(NativePalette.muted)
        }
        .padding(.top, 16)

        CaptionView(snapshot: session.snapshot, bot: bot, participants: participants)
          .frame(maxWidth: 560)
          .frame(maxHeight: 190)
          .padding(.horizontal, 26)
          .padding(.top, 12)

        if session.snapshot.transcript.isEmpty && session.snapshot.partialTranscript.isEmpty {
          VStack(spacing: 10) {
            Image(systemName: "mic")
              .font(.system(size: 30, weight: .regular))
              .foregroundStyle(NativePalette.muted)
            Text("Start speaking when you are ready.")
              .font(.system(size: 19, weight: .regular, design: .rounded))
              .foregroundStyle(NativePalette.muted)
              .multilineTextAlignment(.center)
          }
          .padding(.horizontal, 24)
          .padding(.top, 12)
        }

        Spacer(minLength: 18)

        HStack(spacing: 44) {
          VoiceCallControl(
            systemName: microphoneMuted ? "mic.slash.fill" : "mic.fill",
            label: microphoneMuted ? "Unmute" : "Mute",
            active: microphoneMuted,
            action: onMuteMicrophone
          )
          VoiceCallControl(
            systemName: "phone.down.fill",
            label: "End call",
            destructive: true,
            action: onStop
          )
          VoiceCallControl(
            systemName: speakerMuted ? "speaker.slash.fill" : "speaker.wave.2.fill",
            label: speakerMuted ? "Unmute" : "Speaker",
            active: speakerMuted,
            action: onMuteSpeaker
          )
        }
        .padding(.horizontal, 28)
        .padding(.bottom, 22)
      }
      .frame(maxWidth: 680)
      .background(
        LinearGradient(
          colors: [
            NativePalette.color("EAF4FF", "1B2533"),
            NativePalette.background,
            NativePalette.background,
          ],
          startPoint: .top,
          endPoint: .bottom
        )
      )
      .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 30, style: .continuous)
          .stroke(NativePalette.separator.opacity(0.75), lineWidth: 1)
      )
      .padding(.horizontal, 12)
      .padding(.vertical, 10)
    }
    .accessibilityElement(children: .contain)
  }

  private var statusText: String {
    switch session.snapshot.state {
    case .disconnected: "Ready"
    case .connecting: "Connecting"
    case .listening, .interrupted: "Listening"
    case .processing: "Thinking"
    case .speaking: "Speaking"
    case .reconnecting: "Reconnecting"
    case .failed(let message): message
    case .ended: "Ended"
    }
  }

  private var statusColor: Color {
    switch session.snapshot.state {
    case .speaking: .green
    case .processing, .connecting, .reconnecting: .orange
    case .failed: .red
    default: NativePalette.link
    }
  }
}

private struct VoiceAvatar: View {
  let bot: Bot?
  let speaking: Bool
  let animate: Bool

  var body: some View {
    ZStack {
      Circle()
        .stroke(NativePalette.link.opacity(0.12), lineWidth: 1)
        .frame(width: 184, height: 184)
        .scaleEffect(speaking && animate ? 1.04 : 1)
      Circle()
        .stroke(NativePalette.link.opacity(0.24), lineWidth: 1)
        .frame(width: 164, height: 164)
        .scaleEffect(speaking && animate ? 1.02 : 1)
      Circle()
        .fill(NativePalette.surface)
        .frame(width: 132, height: 132)
        .shadow(color: NativePalette.link.opacity(0.18), radius: 18)
      BotGlyph(
        color: Color(hex: bot?.color ?? "D8E9FF"),
        kind: bot?.icon ?? "chip",
        size: 112,
        mode: speaking ? .thinking : .idle
      )
      .clipShape(Circle())
    }
    .animation(
      .easeInOut(duration: 1.25).repeatForever(autoreverses: true),
      value: animate
    )
    .accessibilityLabel(bot?.title ?? "Assistant")
  }
}

private struct CaptionView: View {
  let snapshot: LiveVoiceSnapshot
  let bot: Bot?
  var participants: [Bot] = []

  private func speakerName(_ entry: LiveVoiceTranscript) -> String {
    guard entry.role == .assistant else { return "You" }
    if let id = entry.speakerBotID, let member = participants.first(where: { $0.id == id }) {
      return member.title.isEmpty ? member.name : member.title
    }
    return bot?.title ?? "Assistant"
  }

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(spacing: 9) {
          ForEach(snapshot.transcript) { entry in
            VStack(spacing: 2) {
              Text(speakerName(entry))
                .font(.caption.weight(.medium))
                .foregroundStyle(NativePalette.muted)
              Text(entry.text)
                .font(.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(entry.role == .assistant ? NativePalette.text : NativePalette.muted)
                .frame(maxWidth: 560)
            }
            .id(entry.id)
          }
          if !snapshot.partialTranscript.isEmpty {
            Text(snapshot.partialTranscript)
              .font(.body)
              .foregroundStyle(NativePalette.link)
              .multilineTextAlignment(.center)
              .frame(maxWidth: 560)
              .id("partial")
          }
          if case .failed(let message) = snapshot.state {
            Text(message)
              .font(.footnote)
              .foregroundStyle(.red)
              .multilineTextAlignment(.center)
          }
        }
        .frame(maxWidth: .infinity)
      }
      .scrollIndicators(.hidden)
      .onChange(of: snapshot.transcript.count) { _, _ in
        if let id = snapshot.transcript.last?.id {
          withAnimation { proxy.scrollTo(id, anchor: .bottom) }
        }
      }
      .onChange(of: snapshot.partialTranscript) { _, _ in
        withAnimation { proxy.scrollTo("partial", anchor: .bottom) }
      }
    }
  }
}

/// The room of a group call: a face for the user and for each bot, in a grid like a meeting. Whoever is
/// talking gets a green ring that spreads outward and a slightly larger face.
private struct ParticipantStage: View {
  let participants: [Bot]
  let defaultSpeakerID: String?
  let speakerBotID: String?
  let userSpeaking: Bool
  let microphoneMuted: Bool

  var body: some View {
    // Up to three across keeps names readable on a phone; more wrap onto another row.
    let rows = stride(from: 0, to: participants.count + 1, by: 3).map { start in
      Array(start..<min(start + 3, participants.count + 1))
    }
    VStack(spacing: 18) {
      ForEach(rows, id: \.self) { indices in
        HStack(alignment: .top, spacing: 0) {
          ForEach(indices, id: \.self) { index in
            Group {
              if index == 0 {
                ParticipantTile(name: "You", speaking: userSpeaking, muted: microphoneMuted, badge: nil) {
                  Image(systemName: "person.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(NativePalette.muted)
                    .frame(width: 76, height: 76)
                    .background(NativePalette.surface, in: Circle())
                }
              } else {
                let member = participants[index - 1]
                ParticipantTile(
                  name: member.title.isEmpty ? member.name : member.title,
                  speaking: member.id == speakerBotID,
                  muted: false,
                  badge: member.id == defaultSpeakerID ? "Host" : nil
                ) {
                  BotGlyph(color: Color(hex: member.color), kind: member.icon, size: 76, mode: .still)
                    .frame(width: 76, height: 76)
                    .clipShape(Circle())
                }
              }
            }
            .frame(maxWidth: .infinity)
          }
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("live-voice-stage")
  }
}

private struct ParticipantTile<Face: View>: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  let name: String
  let speaking: Bool
  let muted: Bool
  let badge: String?
  @ViewBuilder let face: () -> Face
  @State private var spread = false

  var body: some View {
    VStack(spacing: 6) {
      ZStack {
        if speaking {
          Circle()
            .stroke(Color.green.opacity(spread ? 0 : 0.55), lineWidth: 2)
            .frame(width: 76, height: 76)
            .scaleEffect(spread ? 1.32 : 1)
        }
        face()
          .overlay(Circle().stroke(speaking ? Color.green : Color.clear, lineWidth: 3))
          .scaleEffect(speaking ? 1.06 : 1)
        if muted {
          Image(systemName: "mic.slash.fill")
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(NativePalette.background)
            .frame(width: 22, height: 22)
            .background(NativePalette.text, in: Circle())
            .offset(x: 28, y: 28)
            .accessibilityLabel("Microphone muted")
        }
      }
      .frame(width: 98, height: 98)
      .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: speaking)
      Text(name)
        .font(.system(size: 14, weight: .medium, design: .rounded))
        .foregroundStyle(speaking ? Color.green : NativePalette.text)
        .lineLimit(1)
      if let badge {
        Text(badge)
          .font(.caption2.weight(.semibold))
          .foregroundStyle(NativePalette.link)
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel(speaking ? "\(name), speaking" : name)
    .onChange(of: speaking) { _, isSpeaking in
      guard isSpeaking, !reduceMotion else { spread = false; return }
      spread = false
      withAnimation(.easeOut(duration: 1.1).repeatForever(autoreverses: false)) { spread = true }
    }
  }
}

private struct VoiceCallControl: View {
  let systemName: String
  let label: String
  var active = false
  var destructive = false
  let action: () -> Void

  var body: some View {
    VStack(spacing: 8) {
      Button(action: action) {
        Image(systemName: systemName)
          .font(.system(size: 25, weight: .medium))
          .foregroundStyle(destructive || active ? .white : NativePalette.text)
          .frame(width: 76, height: 76)
          .background(
            destructive ? Color.red.opacity(0.88) :
              active ? NativePalette.text : NativePalette.surface,
            in: Circle()
          )
          .overlay(Circle().stroke(NativePalette.separator, lineWidth: 1))
      }
      .accessibilityLabel(label)
      Text(label)
        .font(.system(size: 16, weight: .regular, design: .rounded))
        .foregroundStyle(NativePalette.muted)
    }
  }
}

private struct LiveVoiceMiniPill: View {
  @ObservedObject var session: LiveVoiceSession
  let bot: Bot?
  let elapsedSeconds: Int
  let onRestore: () -> Void
  let onStop: () -> Void

  var body: some View {
    HStack(spacing: 12) {
      VoiceAvatar(bot: bot, speaking: session.snapshot.state == .speaking, animate: false)
        .frame(width: 42, height: 42)
        .clipped()
      VStack(alignment: .leading, spacing: 2) {
        Text(bot?.title ?? bot?.name ?? "Assistant")
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(NativePalette.text)
          .lineLimit(1)
        Text("\(statusText) · \(String(format: "%02d:%02d", elapsedSeconds / 60, elapsedSeconds % 60))")
          .font(.caption)
          .foregroundStyle(NativePalette.muted)
      }
      Spacer(minLength: 4)
      Button(action: onRestore) {
        Image(systemName: "arrow.up.left.and.arrow.down.right")
          .frame(width: 36, height: 36)
      }
      .accessibilityLabel("Restore realtime voice")
      Button(action: onStop) {
        Image(systemName: "xmark")
          .frame(width: 36, height: 36)
      }
      .accessibilityLabel("End realtime voice")
    }
    .foregroundStyle(NativePalette.text)
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .background(NativePalette.surface, in: Capsule())
    .overlay(Capsule().stroke(NativePalette.separator, lineWidth: 1))
    .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
    .accessibilityElement(children: .contain)
  }

  private var statusText: String {
    switch session.snapshot.state {
    case .connecting: "Connecting"
    case .processing: "Thinking"
    case .speaking: "Speaking"
    case .failed: "Connection problem"
    default: "Listening"
    }
  }
}
