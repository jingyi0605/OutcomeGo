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
  public let workItemId: String?
  public let createdAt: String
  public let updatedAt: String

  /// Queued or running: the bot is still working on it.
  public var inProgress: Bool { status == "queued" || status == "running" }
}

public struct OutcomeThreadView: Decodable, Sendable {
  public let threadId: String?
  public let turns: [OutcomeThreadTurn]
  public let reviewerThreadId: String?
  public let reviewTurns: [OutcomeThreadTurn]?
}

/// `POST /api/v0/outcomes` for a new goal: the owner's words become its description and the chosen
/// bot plans it.
public struct CreateOutcome: Encodable, Sendable, Equatable {
  public let kind: String
  public let title: String
  public let description: String
  public let botId: String
  public let clientRequestId: String

  public init(goal words: String, botId: String, clientRequestId: String) {
    let description = words.trimmingCharacters(in: .whitespacesAndNewlines)
    kind = "standard"
    title = Self.title(from: description)
    self.description = description
    self.botId = botId
    self.clientRequestId = clientRequestId
  }

  /// The first line, shortened to 60 UTF-16 units (the server's measure) without splitting a character.
  private static func title(from words: String) -> String {
    let line = (words.split(whereSeparator: \.isNewline).first.map(String.init) ?? "")
      .trimmingCharacters(in: .whitespaces)
    guard line.utf16.count > 60 else { return line }
    var prefix = ""
    for character in line {
      guard prefix.utf16.count + character.utf16.count <= 57 else { break }
      prefix.append(character)
    }
    return prefix + "…"
  }
}

public struct CreatedOutcome: Decodable, Sendable {
  public let outcome: OutcomeDetail
  /// Nil when no planning was queued.
  public let turn: OutcomeThreadTurn?
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
  public static func outcomeAdoptPrereviewPath(_ id: String) -> String {
    "/api/v0/outcomes/\(segment(id))/reviews/adopt-prereview"
  }
}
