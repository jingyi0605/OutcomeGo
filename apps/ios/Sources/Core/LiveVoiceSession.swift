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

public struct LiveVoiceTranscript: Equatable, Sendable, Identifiable {
  public enum Role: Sendable { case user, assistant }
  public let id: String
  public let role: Role
  public let text: String
  /// The bot that spoke this line in a group call; nil in a one-bot call or for the user.
  public let speakerBotID: String?

  public init(id: String, role: Role, text: String, speakerBotID: String? = nil) {
    self.id = id
    self.role = role
    self.text = text
    self.speakerBotID = speakerBotID
  }
}

public struct LiveVoiceSnapshot: Equatable, Sendable {
  public var sessionID: String
  public var state: LiveVoiceState
  public var generation: UInt32
  public var partialTranscript: String
  public var transcript: [LiveVoiceTranscript]
  /// The bot whose voice is playing now, so a group call can light up the right face.
  public var speakerBotID: String?
  /// True while the user is mid-utterance.
  public var userSpeaking: Bool

  public init(
    sessionID: String,
    state: LiveVoiceState = .disconnected,
    generation: UInt32 = 0,
    partialTranscript: String = "",
    transcript: [LiveVoiceTranscript] = [],
    speakerBotID: String? = nil,
    userSpeaking: Bool = false
  ) {
    self.sessionID = sessionID
    self.state = state
    self.generation = generation
    self.partialTranscript = partialTranscript
    self.transcript = transcript
    self.speakerBotID = speakerBotID
    self.userSpeaking = userSpeaking
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
  case let .partial(text):
    next.state = .listening
    next.partialTranscript = String(text.prefix(8_000))
    // An empty partial is how the server withdraws a turn it discarded as noise.
    next.userSpeaking = !text.isEmpty
  case .final: next.state = .processing; next.partialTranscript = ""; next.userSpeaking = false
  case let .bargeIn(generation), let .stopped(generation):
    next.state = .interrupted
    next.generation = max(next.generation, generation)
    next.speakerBotID = nil
  case let .failed(message): next.state = .failed(String(message.prefix(500)))
  case .ended: next.state = .ended
  }
  return next
}

@MainActor
public final class LiveVoiceSession: NSObject, ObservableObject {
  @Published public private(set) var snapshot: LiveVoiceSnapshot
  private var socket: URLSessionWebSocketTask?
  private let audio = LiveVoiceAudio()
  private var api: API?
  private var sequence: UInt32 = 0
  private var inputSequence: UInt32 = 0
  private var stoppedGeneration: UInt32?
  private var microphoneMuted = false
  private var speakerMuted = false
  private var serverReady = false

  public init(sessionID: String) { snapshot = LiveVoiceSnapshot(sessionID: sessionID) }

  /// Creates the short-lived server ticket before opening the media socket. The
  /// bearer token is used only by this authenticated HTTP request and never by
  /// the WebSocket URL or payload. `participantBotIDs` is set for a group call:
  /// the bots that may answer, with `botID` as the one who answers when nobody is named.
  public func start(api: API, botID: String, channelID: String, participantBotIDs: [String] = []) {
    self.api = api
    snapshot.speakerBotID = nil
    snapshot.userSpeaking = false
    sequence = 0
    inputSequence = 0
    stoppedGeneration = nil
    microphoneMuted = false
    speakerMuted = false
    serverReady = false
    Task { @MainActor [weak self] in
      guard let self else { return }
      do {
        var request: [String: JSON] = [
          "botId": .string(botID), "channelId": .string(channelID),
          "clientPlatform": .string("ios"),
          "clientInstanceId": .string("ios:" + UUID().uuidString),
        ]
        if !participantBotIDs.isEmpty { request["participantBotIds"] = .array(participantBotIDs.map { .string($0) }) }
        let ticket = try await api.request("/api/voice/sessions", method: "POST", body: .object(request))
        let id = ticket["id"].string
        let path = ticket["path"].string
        let protocols = ticket["protocols"].array.map(\.string)
        guard !id.isEmpty, !path.isEmpty, protocols.count == 2 else { throw APIError("The server returned an invalid voice ticket.") }
        self.snapshot.sessionID = id
        let base = api.baseURL
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        components.scheme = base.scheme == "https" ? "wss" : "ws"
        components.percentEncodedPath = components.percentEncodedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path
        guard let url = components.url else { throw APIError("The voice socket URL is invalid.") }
        self.connect(url: url, protocols: protocols)
        try self.audio.start(
          onInput: { [weak self] opus in
            guard self != nil else { return }
            Task { @MainActor [weak self] in self?.sendInputOpus(opus) }
          },
          onPlaybackAck: { [weak self] generation, frameSequence in
            guard self != nil else { return }
            Task { @MainActor [weak self] in
              self?.sendPlaybackAck(generation: generation, frameSequence: frameSequence)
            }
          }
        )
      } catch {
        snapshot = reduceLiveVoice(snapshot, command: .failed(error.localizedDescription))
      }
    }
  }

  public func connect(url: URL, protocols: [String]) {
    snapshot.state = .connecting
    let configuration = URLSessionConfiguration.ephemeral
    let session = URLSession(configuration: configuration)
    socket = session.webSocketTask(with: url, protocols: protocols)
    socket?.resume()
    receive()
  }

  public func stop() {
    let endedID = snapshot.sessionID
    sendControl(type: "stop")
    socket?.cancel(with: .normalClosure, reason: "Voice session stopped".data(using: .utf8))
    socket = nil
    serverReady = false
    audio.stop()
    snapshot.speakerBotID = nil
    snapshot.userSpeaking = false
    snapshot = reduceLiveVoice(snapshot, command: .ended)
    if let api, !endedID.isEmpty {
      Task { _ = try? await api.request("/api/voice/sessions/\(API.segment(endedID))", method: "DELETE") }
    }
  }

  public func setMicrophoneMuted(_ muted: Bool) {
    microphoneMuted = muted
  }

  public func setSpeakerMuted(_ muted: Bool) {
    speakerMuted = muted
  }

  private func receive() {
    socket?.receive { [weak self] result in
      Task { @MainActor in
        guard let self else { return }
        switch result {
        case .success(.string(let text)):
          self.handle(text)
          self.receive()
        case .success(.data(let data)):
          self.handleOutput(data)
          self.receive()
        case .failure(let error): self.snapshot = reduceLiveVoice(self.snapshot, command: .failed(error.localizedDescription))
        @unknown default: break
        }
      }
    }
  }

  private func handle(_ text: String) {
    guard let data = text.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let type = object["type"] as? String else { return }
    switch type {
    case "ready":
      serverReady = true
      snapshot = reduceLiveVoice(snapshot, command: .connected)
      sendControl(type: "client_ready")
    case "turn.started": snapshot.state = .listening; snapshot.userSpeaking = true
    case "transcript.partial": if let value = object["text"] as? String { snapshot = reduceLiveVoice(snapshot, command: .partial(value)) }
    case "transcript.final":
      if let value = object["text"] as? String {
        snapshot = reduceLiveVoice(snapshot, command: .final(value))
        snapshot.transcript.append(.init(
          id: "\(object["turnId"] as? String ?? UUID().uuidString):user",
          role: .user,
          text: value
        ))
      }
    case "barge_in":
      if let value = generation(from: object) {
        stoppedGeneration = max(stoppedGeneration ?? 0, value)
        audio.stopPlayback()
        snapshot = reduceLiveVoice(snapshot, command: .bargeIn(value))
      }
    case "audio.stopped":
      if let value = generation(from: object) {
        stoppedGeneration = max(stoppedGeneration ?? 0, value)
        audio.stopPlayback()
        snapshot = reduceLiveVoice(snapshot, command: .stopped(value))
      }
    case "reply.message":
      snapshot.state = .speaking
      if let value = object["text"] as? String, !value.isEmpty {
        let entry = LiveVoiceTranscript(
          id: object["messageId"] as? String ?? UUID().uuidString,
          role: .assistant,
          text: value,
          speakerBotID: (object["speakerBotId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        )
        // A reply spoken while it was still being written shows the sentences so far first; the
        // saved message replaces that line instead of adding a second one.
        if let replaced = object["replaces"] as? String,
          let index = snapshot.transcript.firstIndex(where: { $0.id == replaced })
        {
          snapshot.transcript[index] = entry
        } else {
          snapshot.transcript.append(entry)
        }
      }
    case "audio.started":
      snapshot.state = .speaking
      snapshot.speakerBotID = (object["speakerBotId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    case "ended": snapshot = reduceLiveVoice(snapshot, command: .ended)
    case "error": snapshot = reduceLiveVoice(snapshot, command: .failed(object["message"] as? String ?? "Voice session failed"))
    default: break
    }
  }

  private func handleOutput(_ data: Data) {
    guard data.count >= 18 else { return }
    let magic = UInt16(data[data.startIndex]) << 8 | UInt16(data[data.startIndex + 1])
    guard magic == 0x4f56, data[data.startIndex + 2] == 1, data[data.startIndex + 3] == 2 else { return }
    let generation = readUInt32(data, at: 4)
    let frameSequence = readUInt32(data, at: 8)
    let payloadLength = Int(readUInt16(data, at: 16))
    guard payloadLength <= 1_275, payloadLength + 18 == data.count else { return }
    if let stoppedGeneration, generation <= stoppedGeneration { return }
    if speakerMuted {
      sendPlaybackAck(generation: generation, frameSequence: frameSequence)
      return
    }
    audio.playOutputPacket(
      data.subdata(in: 18..<(18 + payloadLength)),
      generation: generation,
      sequence: frameSequence
    )
  }

  private func sendInputOpus(_ opus: Data) {
    guard socket != nil, serverReady, !microphoneMuted else { return }
    socket?.send(.data(encodeFrame(kind: 1, generation: 0, sequence: inputSequence, timestamp: UInt32(Date().timeIntervalSince1970 * 1000), payload: opus))) { _ in }
    inputSequence &+= 1
  }

  private func sendPlaybackAck(generation: UInt32, frameSequence: UInt32) {
    sendControl(type: "playback.ack", fields: [
      "generation": Int(generation),
      "frameSequence": Int(frameSequence),
    ])
  }

  private func sendControl(type: String, fields: [String: Any] = [:]) {
    guard let socket else { return }
    var object: [String: Any] = ["type": type, "version": 1, "sessionId": snapshot.sessionID, "sequence": sequence]
    sequence &+= 1
    fields.forEach { object[$0.key] = $0.value }
    guard let data = try? JSONSerialization.data(withJSONObject: object), let text = String(data: data, encoding: .utf8) else { return }
    socket.send(.string(text)) { _ in }
  }

  private func encodeFrame(kind: UInt8, generation: UInt32, sequence: UInt32, timestamp: UInt32, payload: Data) -> Data {
    var data = Data([0x4f, 0x56, 1, kind])
    [generation, sequence, timestamp].forEach { value in
      data.append(UInt8((value >> 24) & 0xff)); data.append(UInt8((value >> 16) & 0xff))
      data.append(UInt8((value >> 8) & 0xff)); data.append(UInt8(value & 0xff))
    }
    let length = UInt16(min(payload.count, 1275))
    data.append(UInt8(length >> 8)); data.append(UInt8(length & 0xff))
    data.append(payload.prefix(Int(length)))
    return data
  }

  private func generation(from object: [String: Any]) -> UInt32? {
    if let value = object["generation"] as? UInt32 { return value }
    if let value = object["generation"] as? NSNumber { return value.uint32Value }
    return nil
  }

  private func readUInt16(_ data: Data, at offset: Int) -> UInt16 {
    UInt16(data[offset]) << 8 | UInt16(data[offset + 1])
  }

  private func readUInt32(_ data: Data, at offset: Int) -> UInt32 {
    UInt32(data[offset]) << 24
      | UInt32(data[offset + 1]) << 16
      | UInt32(data[offset + 2]) << 8
      | UInt32(data[offset + 3])
  }
}
