import Foundation

public struct MobileTodoPage: Decodable, Sendable {
  public let items: [MobileTodo]
  public let nextCursor: String?
}

public struct MobileTodo: Decodable, Sendable, Identifiable {
  public let id: String
  public let title: String
  public let status: String
  public let displayState: String
  public let revision: Int
  public let overdue: Bool?
  public let note: String?
  public let summary: String?
  public let dueAt: String?
  public let scheduledAt: String?
  public let followUpAt: String?

  public var actions: [MobileTodoAction] {
    switch status {
    case "suggested": [.accept, .snooze, .dismiss]
    case "open", "waiting": [.complete, .snooze, .dismiss]
    default: []
    }
  }

  public var attentionDate: String? {
    displayState == "follow_up" ? followUpAt : (dueAt ?? scheduledAt)
  }
}

public enum MobileTodoAction: String, CaseIterable, Sendable {
  case accept, snooze, dismiss, complete
}

extension API {
  public func needsMeTodos(cursor: String? = nil) async throws -> MobileTodoPage? {
    var query = ["view": "needs_me"]
    query["cursor"] = cursor
    do { return try await get("/api/v0/todos", as: MobileTodoPage.self, query: query) }
    catch let error as APIError where error.status == 404 { return nil }
  }

  public func actOnTodo(_ item: MobileTodo, action: MobileTodoAction, snoozeUntil: Date? = nil) async throws {
    var body: [String: JSON] = ["revision": .number(Double(item.revision))]
    if action == .snooze {
      guard let snoozeUntil else { throw APIError("Choose a future snooze time.") }
      body["snoozeUntil"] = .string(ISO8601DateFormatter().string(from: snoozeUntil))
    }
    _ = try await request("/api/v0/todos/\(Self.segment(item.id))/\(action.rawValue)", method: "POST", body: .object(body))
  }
}
