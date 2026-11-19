import Foundation

/// A goal notice the platform posted into a Bot conversation. It is not a Bot message: the Bot is
/// not woken and does not see it unless the user quotes it in the main thread.
public struct OutcomeUpdateCard: Equatable, Sendable {
  public let outcomeId: String
  public let title: String
  /// The stage saved when the notice was posted; the live Outcome status supersedes it.
  public let stage: String

  public init?(_ message: Message) {
    guard message.sender == "system", message.metadata["type"].string == "outcome-card",
      message.metadata["source"].string == "outcome-update" else { return nil }
    let card = message.metadata["outcomeCard"]
    let id = card["outcomeId"].string
    guard UUID(uuidString: id) != nil else { return nil }
    outcomeId = id
    title = card["title"].string
    stage = card["stage"].string
  }

  public var target: OutcomeLinkTarget { OutcomeLinkTarget(outcomeId: outcomeId, decisionId: nil) }

  /// Mirrors `outcomeCardStage` in the shared contracts.
  public static func stage(forStatus status: String) -> String {
    switch status {
    case "accepted", "cancelled", "failed": return status
    case "review_pending": return "review"
    case "approved": return "ready"
    case "planning": return "generating"
    case "decision_pending", "human_action_pending", "blocked", "paused": return "attention"
    case "draft", "pending_approval": return "draft"
    case "running": return "running"
    default: return "attention"
    }
  }
}

extension Message {
  public var outcomeUpdateCard: OutcomeUpdateCard? { OutcomeUpdateCard(self) }
}
