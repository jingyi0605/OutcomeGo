import Foundation
import Combine

public enum LiveVoiceState: Equatable, Sendable {
  case disconnected
  case connecting
  case listening
  case processing
  case speaking
  case interrupted
  case reconnecting
  case failed(String)
  case ended
}

public struct LiveVoiceSnapshot: Equatable, Sendable {
  public var sessionID: String
  public var state: LiveVoiceState
  public var generation: UInt32
  public var partialTranscript: String

  public init(sessionID: String, state: LiveVoiceState = .disconnected, generation: UInt32 = 0, partialTranscript: String = "") {
    self.sessionID = sessionID
    self.state = state
    self.generation = generation
    self.partialTranscript = partialTranscript
  }
}

public enum LiveVoiceCommand: Sendable {
  case connected
  case partial(String)
  case final(String)
  case bargeIn(UInt32)
  case stopped(UInt32)
  case failed(String)
  case ended
}

public func reduceLiveVoice(_ snapshot: LiveVoiceSnapshot, command: LiveVoiceCommand) -> LiveVoiceSnapshot {
  var next = snapshot
  switch command {
  case .connected: next.state = .listening
  case let .partial(text): next.state = .listening; next.partialTranscript = String(text.prefix(8_000))
  case let .final(text): next.state = .processing; next.partialTranscript = String(text.prefix(20_000))
  case let .bargeIn(generation), let .stopped(generation): next.state = .interrupted; next.generation = max(next.generation, generation)
  case let .failed(message): next.state = .failed(String(message.prefix(500)))
  case .ended: next.state = .ended
  }
  return next
}

@MainActor
public final class LiveVoiceSession: NSObject, ObservableObject {
  @Published public private(set) var snapshot: LiveVoiceSnapshot
  private var socket: URLSessionWebSocketTask?

  public init(sessionID: String) { snapshot = LiveVoiceSnapshot(sessionID: sessionID) }

  public func connect(url: URL, protocols: [String]) {
    snapshot.state = .connecting
    let configuration = URLSessionConfiguration.ephemeral
    let session = URLSession(configuration: configuration)
    socket = session.webSocketTask(with: url, protocols: protocols)
    socket?.resume()
    receive()
  }

  public func stop() {
    socket?.cancel(with: .normalClosure, reason: "Voice session stopped".data(using: .utf8))
    socket = nil
    snapshot = reduceLiveVoice(snapshot, command: .ended)
  }

  private func receive() {
    socket?.receive { [weak self] result in
      Task { @MainActor in
        guard let self else { return }
        switch result {
        case .success(.string(let text)):
          self.handle(text)
          self.receive()
        case .success(.data): self.receive()
        case .failure(let error): self.snapshot = reduceLiveVoice(self.snapshot, command: .failed(error.localizedDescription))
        @unknown default: break
        }
      }
    }
  }

  private func handle(_ text: String) {
    guard let data = text.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let type = object["type"] as? String else { return }
    switch type {
    case "ready": snapshot = reduceLiveVoice(snapshot, command: .connected)
    case "transcript.partial": if let value = object["text"] as? String { snapshot = reduceLiveVoice(snapshot, command: .partial(value)) }
    case "transcript.final": if let value = object["text"] as? String { snapshot = reduceLiveVoice(snapshot, command: .final(value)) }
    case "barge_in": if let value = object["generation"] as? UInt32 { snapshot = reduceLiveVoice(snapshot, command: .bargeIn(value)) }
    case "audio.stopped": if let value = object["generation"] as? UInt32 { snapshot = reduceLiveVoice(snapshot, command: .stopped(value)) }
    case "ended": snapshot = reduceLiveVoice(snapshot, command: .ended)
    default: break
    }
  }
}
