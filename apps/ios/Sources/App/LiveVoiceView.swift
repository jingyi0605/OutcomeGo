import SwiftUI
import OpenTeamCore

public struct LiveVoiceView: View {
  @ObservedObject private var session: LiveVoiceSession
  private let onStop: () -> Void

  public init(session: LiveVoiceSession, onStop: @escaping () -> Void) {
    self.session = session
    self.onStop = onStop
  }

  public var body: some View {
    VStack(spacing: 12) {
      Text(statusText).font(.subheadline).accessibilityLabel(statusText)
      Button(action: onStop) { Label("Stop realtime voice", systemImage: "stop.fill") }
        .buttonStyle(.borderedProminent)
        .accessibilityHint("Ends the realtime voice session")
    }
    .padding()
  }

  private var statusText: String {
    switch session.snapshot.state {
    case .disconnected: "Ready"
    case .connecting: "Connecting"
    case .listening: "Listening"
    case .processing: "Processing"
    case .speaking: "Speaking"
    case .interrupted: "Interrupted"
    case .reconnecting: "Reconnecting"
    case .failed(let message): message
    case .ended: "Ended"
    }
  }
}
