import Foundation
import XCTest
@testable import OutcomeGoCore

final class OutcomeInboxTests: XCTestCase {
  private func fixture(_ name: String) throws -> Data {
    try Data(contentsOf: XCTUnwrap(Bundle.module.url(forResource: "outcome-" + name, withExtension: "json", subdirectory: "Fixtures")))
  }
  private func decision() throws -> OutcomeDecision { try JSONDecoder().decode(OutcomeDecision.self, from: fixture("decision")) }

  func testFrozenInboxHumanCardAndReadOnlyReceiptHistory() throws {
    let page = try JSONDecoder().decode(OutcomeInboxPage.self, from: fixture("inbox"))
    XCTAssertEqual(Set(page.items.map(\.category)), ["decision_pending", "acceptance_pending", "human_action_pending", "completed"])
    let detail = try JSONDecoder().decode(OutcomeHumanWorkItem.self, from: fixture("human"))
    XCTAssertEqual(detail.status, "future_status")
    XCTAssertEqual(detail.card?.inputFields.first?.type, "future_input")
    XCTAssertEqual(detail.card?.references.first?.stale, true)
    XCTAssertEqual(detail.receipts?.first?.reviewComment, "Add a photo")
    XCTAssertEqual(detail.receipts?.first?.missingRequirements.first?.label, "Missing photo")
  }
  func testUncertainRetryKeepsBodyAndRequestIdUntilChoiceEdited() throws {
    let value = try decision()
    var draft = OutcomeDecisionDraft()
    draft.choose("keep")
    let first = draft.prepare(for: value, requestID: { "request-1" })
    let retry = draft.prepare(for: value, requestID: { XCTFail("A retry must reuse the ID"); return "request-2" })
    XCTAssertEqual(first, retry)
    draft.edit("  Explain the result  ")
    let changed = draft.prepare(for: value, requestID: { "request-2" })
    XCTAssertNil(changed.optionId)
    XCTAssertEqual(changed.customText, "Explain the result")
    XCTAssertEqual(changed.clientRequestId, "request-2")
    let body = try JSONDecoder().decode(JSON.self, from: JSONEncoder().encode(changed))
    XCTAssertEqual(Set(body.object.keys), ["customText", "expectedContractRevision", "clientRequestId"])
  }
  func testConflictRefreshKeepsChoiceAndTerminalStatusesCannotSubmit() throws {
    let value = try decision()
    var draft = OutcomeDecisionDraft()
    draft.choose("keep")
    XCTAssertTrue(draft.valid(for: value))
    let original = try JSONDecoder().decode(JSON.self, from: fixture("decision"))
    var removed = original
    removed["options"] = .array([])
    XCTAssertFalse(draft.valid(for: try removed.decode(OutcomeDecision.self)))
    XCTAssertEqual(draft.optionId, "keep")
    for state in ["expired", "withdrawn", "resolved", "future_status"] {
      var current = original; current["status"] = .string(state)
      XCTAssertFalse(draft.valid(for: try current.decode(OutcomeDecision.self)))
    }
    draft.edit(String(repeating: "x", count: 4001))
    XCTAssertFalse(draft.valid(for: value))
  }
  func testNotificationVersionsTypesAndDeepLinkIdentityAreValidated() throws {
    let outcome = "11111111-1111-4111-8111-111111111111"
    let decision = "22222222-2222-4222-8222-222222222222"
    let url = try XCTUnwrap(URL(string: "outcomego://app/v1/outcomes/decision?id=\(decision)"))
    let target = try XCTUnwrap(OutcomeLinkTarget.parse(url))
    var payload: JSON = .object(["kind": .string("outcome"), "schemaVersion": .number(1),
      "type": .string("outcome.decision.required"), "outcomeId": .string(outcome),
      "decisionId": .string(decision), "deepLink": .string(url.absoluteString)])
    XCTAssertEqual(OutcomeLinkTarget.push(payload), target)
    let push = NativePush(.object(["data": payload]))
    XCTAssertTrue(push.isAlert)
    XCTAssertEqual(push.outcomeTarget, target)
    var reads = NotificationReads(scope: "account")
    reads.merge(NotificationReadMarker(json: .object(["channelId": .string("chat"), "lastReadSequence": .string("999"), "lastReadNotificationSequence": .string("999")]))!)
    XCTAssertFalse(reads.hasRead(push))
    payload["schemaVersion"] = .number(2)
    XCTAssertNil(OutcomeLinkTarget.push(payload))
    payload["schemaVersion"] = .number(1); payload["type"] = .string("outcome.future")
    XCTAssertNil(OutcomeLinkTarget.push(payload))
    for raw in [url.absoluteString + "&token=private", url.absoluteString + "#private", "https://app/v1/outcomes?id=\(outcome)", "outcomego://app/v1/outcomes?id=invalid"] {
      XCTAssertNil(OutcomeLinkTarget.parse(try XCTUnwrap(URL(string: raw))))
    }
    for kind in ["outcome.review.required", "outcome.human_action.required", "outcome.accepted", "outcome.failed", "outcome.blocked"] {
      payload["type"] = .string(kind)
      payload["deepLink"] = .string("outcomego://app/v1/outcomes?id=\(outcome)")
      XCTAssertEqual(OutcomeLinkTarget.push(payload)?.outcomeId, outcome)
    }
  }
  func testLegacyChatPayloadRemainsAnAlertAndUnknownOutcomeIsIgnored() {
    let legacy = NativePush(.object(["data": .object(["kind": .string("message"), "channelId": .string("chat")])]))
    XCTAssertTrue(legacy.isAlert)
    XCTAssertNil(legacy.outcomeTarget)
    let unknown = NativePush(.object(["data": .object(["kind": .string("outcome"), "schemaVersion": .number(2), "type": .string("outcome.future")])]))
    XCTAssertFalse(unknown.isAlert)
  }
  func testInboxQueryKeepsOpaqueCursorAndAllCategories() {
    XCTAssertEqual(API.outcomeInboxQuery(category: "completed", cursor: "opaque/+="),
      ["status": "all", "limit": "30", "category": "completed", "cursor": "opaque/+="])
  }
  func testGoalNoticeCardIsRecognisedOnlyWhenThePlatformPostedIt() throws {
    let outcome = "11111111-1111-4111-8111-111111111111"
    func message(sender: String, source: String?, outcomeId: String = outcome) throws -> Message {
      var metadata: [String: JSON] = ["type": .string("outcome-card"),
        "outcomeCard": .object(["stage": .string("attention"), "title": .string("Clean storage"), "outcomeId": .string(outcomeId)])]
      if let source { metadata["source"] = .string(source) }
      let value: JSON = .object(["id": .string("m1"), "sequence": .string("1"), "channelId": .string("c1"),
        "sender": .string(sender), "content": .string("Goal · Clean storage · attention"),
        "metadata": .object(metadata), "createdAt": .string("2026-11-18T00:00:00.000Z")])
      return try JSONDecoder().decode(Message.self, from: JSONEncoder().encode(value))
    }
    let card = try XCTUnwrap(try message(sender: "system", source: "outcome-update").outcomeUpdateCard)
    XCTAssertEqual(card.outcomeId, outcome)
    XCTAssertEqual(card.title, "Clean storage")
    XCTAssertEqual(card.stage, "attention")
    XCTAssertEqual(card.target, OutcomeLinkTarget.parse(try XCTUnwrap(URL(string: "outcomego://app/v1/outcomes?id=\(outcome)"))))
    XCTAssertNil(try message(sender: "agent", source: "outcome-update").outcomeUpdateCard)
    XCTAssertNil(try message(sender: "system", source: nil).outcomeUpdateCard)
    XCTAssertNil(try message(sender: "system", source: "outcome-update", outcomeId: "not-a-uuid").outcomeUpdateCard)
    XCTAssertEqual(OutcomeUpdateCard.stage(forStatus: "review_pending"), "review")
    XCTAssertEqual(OutcomeUpdateCard.stage(forStatus: "human_action_pending"), "attention")
    XCTAssertEqual(OutcomeUpdateCard.stage(forStatus: "failed"), "failed")
  }
}
