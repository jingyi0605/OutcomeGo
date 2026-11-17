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

  func testDraftCanHaveNoRevisionAndEmptyTerminalPage() throws {
    let data = Data(#"{"items":[{"id":"draft","title":"Draft","status":"draft","botId":"b","currentRevision":null,"updatedAt":"now"}],"nextCursor":null}"#.utf8)
    let page = try JSONDecoder().decode(OutcomeListPage.self, from: data)
    XCTAssertNil(page.items.first?.currentRevision)
    XCTAssertNil(page.nextCursor)
  }
}
