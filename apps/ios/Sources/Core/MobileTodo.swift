import Foundation

public struct MobileTodoPage: Decodable, Sendable {
  public let items: [MobileTodo]
  public let nextCursor: String?
}

/// A `kind=todo` Outcome as listed by the unified collection; the body is only in its detail.
public struct MobileTodo: Decodable, Sendable, Identifiable {
  public struct Meta: Decodable, Sendable {
    public let summary: String?
  }

  public let id: String
  public let title: String
  public let status: String
  public let revision: Int
  public let kindMeta: Meta?
  public let dueAt: String?
  public let scheduledAt: String?
  public let followUpAt: String?

  public var summary: String? { kindMeta?.summary }

  public var actions: [MobileTodoAction] {
    switch status {
    case "suggested": [.accept, .snooze, .dismiss]
    case "open", "waiting": [.complete, .snooze, .dismiss]
    default: []
    }
  }

  /// Why an accepted to-do needs the owner, judged by this device's clock and calendar.
  public func attention(now: Date = .now, calendar: Calendar = .current) -> MobileTodoAttention? {
    guard status == "open" || status == "waiting" else { return nil }
    let due = Self.date(dueAt)
    if let due, due < now { return .overdue }
    if status == "waiting", let followUp = Self.date(followUpAt), followUp <= now { return .followUp }
    guard let date = due ?? (status == "open" ? Self.date(scheduledAt) : nil) else { return nil }
    return calendar.compare(date, to: now, toGranularity: .day) == .orderedSame ? .today : nil
  }

  public func attentionDate(now: Date = .now) -> Date? {
    Self.date(attention(now: now) == .followUp ? followUpAt : (dueAt ?? scheduledAt))
  }

  private static func date(_ value: String?) -> Date? {
    guard let value else { return nil }
    return (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value))
      ?? (try? Date.ISO8601FormatStyle().parse(value))
  }
}

public enum MobileTodoAttention: Sendable {
  case followUp, overdue, today
}

public enum MobileTodoAction: String, CaseIterable, Sendable {
  case accept = "accept_todo", snooze, dismiss, complete
}

extension API {
  public func needsMeTodos(cursor: String? = nil) async throws -> MobileTodoPage? {
    var query = ["limit": "100", "kinds": "todo", "view": "needs_me"]
    query["cursor"] = cursor
    do { return try await get(Self.outcomesPath, as: MobileTodoPage.self, query: query) }
    catch let error as APIError where error.status == 404 { return nil }
  }

  public func actOnTodo(_ item: MobileTodo, action: MobileTodoAction, snoozeUntil: Date? = nil) async throws {
    var body: [String: JSON] = [
      "action": .string(action.rawValue),
      "expectedRevision": .number(Double(item.revision)),
      "clientRequestId": .string(UUID().uuidString),
    ]
    if action == .snooze {
      guard let snoozeUntil else { throw APIError("Choose a future snooze time.") }
      body["payload"] = .object(["snoozeUntil": .string(ISO8601DateFormatter().string(from: snoozeUntil))])
    }
    _ = try await request(Self.outcomeActionsPath(item.id), method: "POST", body: .object(body))
  }
}
