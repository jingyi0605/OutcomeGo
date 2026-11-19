import Foundation

/// A goal's own bot thread (specs/004.8). What the owner sends reaches the bot as written; whether it
/// means cancel, change or a question is the bot's call, so the app never labels or rewrites it.
public struct OutcomeThreadTurn: Decodable, Sendable, Identifiable, Equatable {
  public struct Failure: Decodable, Sendable, Equatable {
    public let code: String?
    public let message: String?
  }
  public let id: String
  public let purpose: String
  /// The owner's words, as sent.
  public let trigger: String
  public let status: String
  /// The bot's final message for the turn.
  public let reply: String?
  public let error: Failure?
  public let runId: String?
  public let createdAt: String
  public let updatedAt: String

  /// Queued or running: the bot is still working on it.
  public var inProgress: Bool { status == "queued" || status == "running" }
}

public struct OutcomeThreadView: Decodable, Sendable {
  public let threadId: String?
  public let turns: [OutcomeThreadTurn]
}

/// A new goal in the owner's own words; the chosen bot plans it.
public struct CreateOutcomeThread: Encodable, Sendable, Equatable {
  public let text: String
  public let botId: String
  public let exploreIdeaId: String?
  public let clientRequestId: String

  public init(text: String, botId: String, exploreIdeaId: String? = nil, clientRequestId: String) {
    self.text = text
    self.botId = botId
    self.exploreIdeaId = exploreIdeaId
    self.clientRequestId = clientRequestId
  }
}

public struct CreatedOutcomeThread: Decodable, Sendable {
  public let outcome: OutcomeDetail
  public let turn: OutcomeThreadTurn
}

public struct SendOutcomeThreadMessage: Encodable, Sendable, Equatable {
  public let text: String
  public let clientRequestId: String

  public init(text: String, clientRequestId: String) {
    self.text = text
    self.clientRequestId = clientRequestId
  }
}

extension API {
  public static func outcomeThreadPath(_ id: String) -> String {
    "/api/v0/outcomes/\(segment(id))/thread"
  }
  public static let outcomeThreadsPath = "/api/v0/outcomes/threads"
}
