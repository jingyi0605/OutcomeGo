import Foundation
import XCTest

@testable import OutcomeGoCore

private final class OutcomeProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) static var status = 200
  nonisolated(unsafe) static var response = Data()
  nonisolated(unsafe) static var received: URLRequest?
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Self.received = request
    client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: Self.status,
      httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Self.response)
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

final class OutcomeReadTests: XCTestCase, @unchecked Sendable {
  private func api() throws -> API {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [OutcomeProtocol.self]
    return try API(server: "https://fixture.invalid/team", token: "fixture-token",
      session: URLSession(configuration: config))
  }
  private func fixture() throws -> Data {
    try Data(contentsOf: XCTUnwrap(Bundle.module.url(forResource: "outcome-detail", withExtension: "json", subdirectory: "Fixtures")))
  }

  func testFrozenDetailPreservesUnknownFieldsAndStatuses() throws {
    let detail = try JSONDecoder().decode(OutcomeDetail.self, from: fixture())
    XCTAssertEqual(detail.status, "future_outcome_status")
    XCTAssertEqual(detail.currentRevision, 2)
    XCTAssertEqual(detail.currentRevisionView?.criteria.first?.latestResult, "future_review_result")
    XCTAssertEqual(detail.workItems.first?.status, "future_work_status")
    XCTAssertEqual(detail.outputs.first?.content, "Plan A recovers faster.")
    XCTAssertEqual(detail.reviews.first?.comment, "Add cost comparison")
    XCTAssertEqual(detail.reviews.first?.evidenceIds.first, detail.evidence.first?.id)
  }

  func testReadRoutesKeepSessionBasePathAndOpaqueCursor() async throws {
    OutcomeProtocol.status = 200
    OutcomeProtocol.response = Data(#"{"items":[],"nextCursor":"next/+=","future":true}"#.utf8)
    let page = try await api().listOutcomes(cursor: "cursor/+=&")
    XCTAssertEqual(page?.nextCursor, "next/+=")
    let request = try XCTUnwrap(OutcomeProtocol.received)
    XCTAssertEqual(request.httpMethod, "GET")
    XCTAssertNil(request.httpBody)
    XCTAssertEqual(request.url?.path, "/team/api/v0/outcomes")
    XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-token")
    let query = URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?.queryItems
    XCTAssertEqual(query?.first { $0.name == "cursor" }?.value, "cursor/+=&")
    XCTAssertEqual(query?.first { $0.name == "limit" }?.value, "20")

    OutcomeProtocol.response = try fixture()
    let detail = try await api().outcomeDetail(id: "outcome/one")
    XCTAssertEqual(detail.id, "outcome-1")
    XCTAssertTrue(OutcomeProtocol.received?.url?.absoluteString.contains("outcome%2Fone") == true)
    XCTAssertEqual(OutcomeProtocol.received?.httpMethod, "GET")
  }

  func testOnlyCollection404MeansUnsupported() async throws {
    OutcomeProtocol.response = Data()
    OutcomeProtocol.status = 404
    let page = try await api().listOutcomes()
    XCTAssertNil(page)
    do { _ = try await api().outcomeDetail(id: "missing"); XCTFail("Missing detail must fail") }
    catch let error as APIError { XCTAssertEqual(error.status, 404) }
    for status in [401, 403, 500] {
      OutcomeProtocol.status = status
      do { _ = try await api().listOutcomes(); XCTFail("HTTP failure must remain visible") }
      catch let error as APIError { XCTAssertEqual(error.status, status) }
    }
  }

  func testGoalManagementSwitchDefaultsOffAndOldServersFallBack() async throws {
    OutcomeProtocol.status = 200
    OutcomeProtocol.response = Data(#"{"outcomesEnabled":true}"#.utf8)
    let enabled = try await api().outcomesEnabled()
    XCTAssertEqual(enabled, true)
    XCTAssertEqual(OutcomeProtocol.received?.url?.path, "/team/api/v0/feature-settings")
    XCTAssertEqual(OutcomeProtocol.received?.httpMethod, "GET")
    OutcomeProtocol.response = Data("{}".utf8)
    let missing = try await api().outcomesEnabled()
    XCTAssertEqual(missing, false)
    OutcomeProtocol.status = 404
    OutcomeProtocol.response = Data()
    let old = try await api().outcomesEnabled()
    XCTAssertNil(old)
    OutcomeProtocol.status = 500
    do { _ = try await api().outcomesEnabled(); XCTFail("HTTP failure must remain visible") }
    catch let error as APIError { XCTAssertEqual(error.status, 500) }
  }

  func testDraftCanHaveNoRevisionAndEmptyTerminalPage() throws {
    let data = Data(#"{"items":[{"id":"draft","title":"Draft","status":"draft","botId":"b","currentRevision":null,"updatedAt":"now"}],"nextCursor":null}"#.utf8)
    let page = try JSONDecoder().decode(OutcomeListPage.self, from: data)
    XCTAssertNil(page.items.first?.currentRevision)
    XCTAssertNil(page.nextCursor)
  }

  func testThreadModelsKeepOwnerWordsAndReportProgress() throws {
    let turns = Data(#"{"threadId":"t","turns":[{"id":"1","purpose":"owner_message","trigger":"取消目标","status":"running","reply":null,"error":null,"runId":null,"createdAt":"now","updatedAt":"now"},{"id":"2","purpose":"plan","trigger":"goal","status":"failed","error":{"code":"x","message":"Bot offline"},"createdAt":"now","updatedAt":"now"}]}"#.utf8)
    let view = try JSONDecoder().decode(OutcomeThreadView.self, from: turns)
    XCTAssertTrue(view.turns[0].inProgress)
    XCTAssertFalse(view.turns[1].inProgress)
    XCTAssertEqual(view.turns[0].trigger, "取消目标")
    XCTAssertEqual(view.turns[1].error?.message, "Bot offline")
    // Words and ids go out exactly as given: no wrapper text, no intent label, no empty idea id.
    let sent = try JSONEncoder().encode(SendOutcomeThreadMessage(text: "取消目标", clientRequestId: "req"))
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: sent) as? [String: String])
    XCTAssertEqual(object, ["text": "取消目标", "clientRequestId": "req"])
    let created = try JSONEncoder().encode(CreateOutcomeThread(text: "goal", botId: "b", clientRequestId: "req"))
    let createdObject = try XCTUnwrap(JSONSerialization.jsonObject(with: created) as? [String: String])
    XCTAssertEqual(createdObject["exploreIdeaId"], nil)
    XCTAssertEqual(API.outcomeThreadPath("a/b"), "/api/v0/outcomes/a%2Fb/thread")
    XCTAssertEqual(API.outcomeAdoptPrereviewPath("a/b"), "/api/v0/outcomes/a%2Fb/reviews/adopt-prereview")
  }

  func testDecodesPlanTaskReviewPrereviewAndAdoptRequest() throws {
    let data = Data(#"""
    {
      "id": "outcome-2",
      "title": "Plan test",
      "status": "review_pending",
      "botId": "bot-planner",
      "currentRevision": 1,
      "updatedAt": "2026-11-22T00:00:00Z",
      "description": "Goal description",
      "plan": {
        "notes": "Keep neutral task phrasing",
        "tasks": [{
          "key": "draft-doc",
          "title": "Draft doc",
          "instructions": "Write draft",
          "botId": "bot-exec",
          "dependsOn": [],
          "covers": ["criterion-1"],
          "nature": "deliverable"
        }]
      },
      "workItems": [{
        "id": "w-1",
        "contractRevision": 1,
        "botId": "bot-exec",
        "executorType": "agent",
        "kind": "execution",
        "title": "Draft doc",
        "status": "completed",
        "ordinal": 1,
        "planKey": "draft-doc",
        "nature": "deliverable",
        "review": {
          "state": "rejected_once",
          "findings": [{
            "kind": "omission",
            "basis": { "criterionId": "criterion-1" },
            "reason": "Missing executive summary"
          }],
          "reworkWorkItemId": "w-2"
        }
      }],
      "outputs": [],
      "evidence": [],
      "reviews": [],
      "prereview": {
        "turnId": "turn-1",
        "revision": 1,
        "summary": "1 likely pass, 1 needs attention",
        "attention": [{ "criterionId": "criterion-1", "question": "Confirm tone" }],
        "results": [{
          "criterionId": "criterion-1",
          "suggestion": "likely_pass",
          "reason": "All sections covered",
          "evidenceIds": ["ev-1"]
        }],
        "createdAt": "2026-11-22T00:00:00Z"
      }
    }
    """#.utf8)
    let decoded = try JSONDecoder().decode(OutcomeDetail.self, from: data)
    XCTAssertEqual(decoded.plan?.tasks.first?.nature, "deliverable")
    XCTAssertEqual(decoded.workItems.first?.review?.state, "rejected_once")
    XCTAssertEqual(decoded.workItems.first?.review?.findings.first?.reason, "Missing executive summary")
    XCTAssertEqual(decoded.prereview?.turnId, "turn-1")

    let threadData = Data(#"""
    {
      "threadId": "th-1",
      "turns": [],
      "reviewerThreadId": "th-rev",
      "reviewTurns": [{
        "id": "rt-1",
        "purpose": "review_task",
        "trigger": "task",
        "status": "completed",
        "reply": "Passed",
        "workItemId": "w-1",
        "createdAt": "now",
        "updatedAt": "now"
      }]
    }
    """#.utf8)
    let thread = try JSONDecoder().decode(OutcomeThreadView.self, from: threadData)
    XCTAssertEqual(thread.reviewerThreadId, "th-rev")
    XCTAssertEqual(thread.reviewTurns?.first?.workItemId, "w-1")

    let req = AdoptPrereviewRequest(expectedRevision: 1, turnId: "turn-1", clientRequestId: "req-12345678")
    let encoded = try JSONEncoder().encode(req)
    let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
    XCTAssertEqual(obj["turnId"] as? String, "turn-1")
    XCTAssertEqual(obj["expectedRevision"] as? Int, 1)
  }
}
