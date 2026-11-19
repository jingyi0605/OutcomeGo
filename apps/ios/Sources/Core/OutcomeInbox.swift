import Foundation

public struct OutcomeInboxItem: Decodable, Sendable, Identifiable {
  public let id: String
  public let outcomeId: String
  public let contractRevision: Int
  public let decisionId: String?
  public let workItemId: String?
  public let criterionIds: [String]?
  public let category: String
  public let priority: Int
  public let title: String
  public let completed: String
  public let problem: String
  public let next: String
  public let requiresAction: Bool
  public let availableAt: String
  public let createdAt: String
  public let read: Bool
}
public struct OutcomeInboxPage: Decodable, Sendable {
  public let items: [OutcomeInboxItem]
  public let nextCursor: String?
}
public struct OutcomeDecisionOption: Decodable, Sendable, Identifiable {
  public let id: String
  public let label: String
  public let consequence: String
  public let resolutionEffect: String
  public let source: String
  public let recommended: Bool?
  public let reason: String?
}
public struct OutcomeRecommendation: Decodable, Sendable {
  public let optionId: String
  public let reason: String
}
public struct OutcomeDecision: Decodable, Sendable, Identifiable {
  public let id: String
  public let outcomeId: String
  public let contractRevisionId: String
  public let contractRevision: Int
  public let runId: String?
  public let workItemId: String?
  public let status: String
  public let reasonCode: String
  public let completedSummary: String
  public let problemSummary: String
  public let nextStepSummary: String
  public let recommendation: OutcomeRecommendation?
  public let options: [OutcomeDecisionOption]
  public let customEntryAllowed: Bool
  public let expiresAt: String?
  public let resolvedOption: OutcomeDecisionOption?
  public let customText: String?
  public let resolvedBy: String?
  public let resolvedAt: String?
  public let truncatedOptionCount: Int
  public let createdAt: String
  public var canResolve: Bool { ["open", "presented"].contains(status) }
}
public struct ResolveOutcomeDecision: Encodable, Sendable, Equatable {
  public let optionId: String?
  public let customText: String?
  public let expectedContractRevision: Int
  public let clientRequestId: String
}
public struct OutcomeDecisionResolution: Decodable, Sendable {
  public let decisionId: String
  public let status: String
  public let outcomeId: String
  public let contractRevision: Int
  public let resolutionEffect: String
  public let resume: OutcomeDecisionResume
}
public struct OutcomeDecisionResume: Decodable, Sendable {
  public let status: String
  public let workItemIds: [String]
  public let revisionId: String?
  public let cardId: String?
}
public struct OutcomeKnowledgeReference: Decodable, Sendable, Identifiable {
  public let id: String
  public let title: String
  public let sourceType: String
  public let sourceRef: String
  public let version: String
  public let updatedAt: String
  public let projectScope: String
  public let excerpt: String?
  public let digest: String?
  public let stale: Bool
  public let permissionSummary: String
}
public struct HumanActionPrerequisite: Decodable, Sendable {
  public let label: String
  public let completed: Bool
}
public struct HumanActionStep: Decodable, Sendable, Identifiable {
  public let id: String
  public let ordinal: Int
  public let text: String
  public let optional: Bool
}
public struct HumanActionInputField: Decodable, Sendable, Identifiable {
  public let id: String
  public let label: String
  public let type: String
  public let required: Bool
}
public struct HumanActionEvidenceRequirement: Decodable, Sendable {
  public let criterionId: String
  public let label: String
  public let acceptedTypes: [String]
  public let required: Bool
}
public struct HumanActionDraft: Decodable, Sendable {
  public let currentStepId: String?
  public let draftSummary: String
  public let readReferenceIds: [String]
  public let reason: String
}
public struct OutcomeHumanActionCard: Decodable, Sendable, Identifiable {
  public let id: String
  public let workItemId: String
  public let outcomeId: String
  public let contractRevision: Int
  public let title: String
  public let purpose: String
  public let prerequisites: [HumanActionPrerequisite]
  public let steps: [HumanActionStep]
  public let inputFields: [HumanActionInputField]
  public let evidenceRequirements: [HumanActionEvidenceRequirement]
  public let references: [OutcomeKnowledgeReference]
  public let status: String
  public let draft: HumanActionDraft?
  public let startedBy: String?
  public let startedAt: String?
  public let submittedAt: String?
  public let acceptedAt: String?
}
public struct OutcomeHumanWorkItem: Decodable, Sendable, Identifiable {
  public let id: String
  public let outcomeId: String
  public let executorType: String
  public let kind: String
  public let status: String
  public let title: String
  public let contractRevision: Int
  public let runId: String?
  public let humanActionCardId: String?
  public let evidenceCount: Int
  public let nextAction: String?
  public let startedAt: String?
  public let card: OutcomeHumanActionCard?
  public let receipts: [OutcomeHumanReceipt]?
}

public struct OutcomeHumanReceipt: Decodable, Sendable, Identifiable {
  public let id: String
  public let sequence: Int
  public let status: String
  public let submittedAt: String
  public let reviewComment: String?
  public let payload: OutcomeHumanReceiptPayload
  public let evidenceIds: [String]
  public let missingRequirements: [OutcomeHumanEvidenceGap]
}
public struct OutcomeHumanReceiptPayload: Decodable, Sendable {
  public let comment: String
  public let text: String
}
public struct OutcomeHumanEvidenceGap: Decodable, Sendable {
  public let criterionId: String
  public let kind: String
  public let label: String
}

/// A retry keeps its immutable body and request ID until the user changes the choice.
public struct OutcomeDecisionDraft: Sendable, Equatable {
  public private(set) var optionId: String?
  public private(set) var customText = ""
  public private(set) var attempt: ResolveOutcomeDecision?
  public init() {}
  public mutating func choose(_ id: String?) {
    if optionId != id { optionId = id; attempt = nil }
  }
  public mutating func edit(_ text: String) {
    if customText != text || optionId != nil {
      optionId = nil; customText = text; attempt = nil
    }
  }
  public func valid(for decision: OutcomeDecision) -> Bool {
    guard decision.canResolve else { return false }
    if let optionId { return decision.options.contains { $0.id == optionId } }
    return decision.customEntryAllowed && !customText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && customText.utf16.count <= 4000
  }
  public mutating func prepare(for decision: OutcomeDecision, requestID: () -> String = { UUID().uuidString }) -> ResolveOutcomeDecision {
    precondition(valid(for: decision))
    if let attempt { return attempt }
    let input = ResolveOutcomeDecision(optionId: optionId,
      customText: optionId == nil ? customText.trimmingCharacters(in: .whitespacesAndNewlines) : nil,
      expectedContractRevision: decision.contractRevision, clientRequestId: requestID())
    attempt = input
    return input
  }
}

/// Pending navigation contains IDs only and is safe to keep until authentication completes.
public struct OutcomeLinkTarget: Hashable, Sendable {
  public let outcomeId: String?
  public let decisionId: String?
  public var url: URL {
    let path = decisionId == nil ? "outcomes" : "outcomes/decision"
    var components = URLComponents(string: "outcomego://app/v1/" + path)!
    components.queryItems = [URLQueryItem(name: "id", value: decisionId ?? outcomeId)]
    return components.url!
  }
  public static func parse(_ url: URL) -> OutcomeLinkTarget? {
    guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
      parts.scheme == "outcomego", parts.host == "app", parts.user == nil, parts.password == nil,
      parts.port == nil, parts.fragment == nil, let query = parts.queryItems, query.count == 1,
      query[0].name == "id", let id = query[0].value, UUID(uuidString: id) != nil else { return nil }
    switch parts.path {
    case "/v1/outcomes": return OutcomeLinkTarget(outcomeId: id, decisionId: nil)
    case "/v1/outcomes/decision": return OutcomeLinkTarget(outcomeId: nil, decisionId: id)
    default: return nil
    }
  }
  public static func push(_ data: JSON) -> OutcomeLinkTarget? {
    guard data["kind"].string == "outcome", data["schemaVersion"] == .number(1) || data["schemaVersion"] == .string("1"),
      ["outcome.decision.required", "outcome.review.required", "outcome.human_action.required", "outcome.accepted", "outcome.failed", "outcome.blocked"].contains(data["type"].string),
      UUID(uuidString: data["outcomeId"].string) != nil,
      let url = URL(string: data["deepLink"].string), let target = parse(url) else { return nil }
    if data["type"].string == "outcome.decision.required" {
      return target.decisionId != nil && target.decisionId == data["decisionId"].string ? target : nil
    }
    return target.outcomeId == data["outcomeId"].string ? target : nil
  }
}

extension API {
  public func outcomeInbox(category: String? = nil, cursor: String? = nil) async throws -> OutcomeInboxPage? {
    do { return try await get("/api/v0/outcome-inbox", as: OutcomeInboxPage.self,
      query: Self.outcomeInboxQuery(category: category, cursor: cursor)) }
    catch let error as APIError where error.status == 404 { return nil }
  }
  public static func outcomeInboxQuery(category: String? = nil, cursor: String? = nil) -> [String: String] {
    var query = ["status": "all", "limit": "30"]
    if let category { query["category"] = category }
    if let cursor { query["cursor"] = cursor }
    return query
  }
  public func outcomeDecision(_ id: String) async throws -> OutcomeDecision {
    try await get("/api/v0/decisions/\(Self.segment(id))", as: OutcomeDecision.self)
  }
  public func resolveOutcomeDecision(_ id: String, input: ResolveOutcomeDecision) async throws -> OutcomeDecisionResolution {
    try await request("/api/v0/decisions/\(Self.segment(id))/resolve", method: "POST", body: .encode(input))
      .decode(OutcomeDecisionResolution.self)
  }
  public func outcomeHumanWorkItem(_ id: String) async throws -> OutcomeHumanWorkItem {
    try await get("/api/v0/work-items/\(Self.segment(id))", as: OutcomeHumanWorkItem.self)
  }
}
