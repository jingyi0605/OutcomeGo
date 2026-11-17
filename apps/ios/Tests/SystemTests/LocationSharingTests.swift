import CoreLocation
import XCTest
@testable import OutcomeGoNative

@MainActor private final class HeldLocationManager: CLLocationManager {
  var status: CLAuthorizationStatus = .authorizedWhenInUse
  private(set) var requests = 0
  override var authorizationStatus: CLAuthorizationStatus { status }
  override func requestLocation() { requests += 1 }
  override func requestWhenInUseAuthorization() {}
  func deliver() {
    delegate?.locationManager?(self, didUpdateLocations: [CLLocation(
      coordinate: CLLocationCoordinate2D(latitude: 47.6097, longitude: -122.3331),
      altitude: 0, horizontalAccuracy: 5, verticalAccuracy: 5, timestamp: Date())])
  }
  func revoke() {
    status = .denied
    delegate?.locationManagerDidChangeAuthorization?(self)
  }
}

private final class LocationProtocol: URLProtocol, @unchecked Sendable {
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let enabled = request.httpMethod != "DELETE"
    let data = Data("{\"sharing\":{\"enabled\":\(enabled),\"revision\":\"7ec8d8cc-46e3-4b59-a996-1317cfaad0a0\"},\"location\":{\"available\":false,\"reason\":\"fixture\"}}".utf8)
    client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200,
      httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: data)
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

/// Source regression coverage pending execution on a full Xcode host. No real permission/GPS is used.
@MainActor final class LocationSharingTests: XCTestCase {
  private var suite = ""
  private var defaults: UserDefaults!
  private var manager: HeldLocationManager!
  private var sharing: LocationSharing!
  private let owner = SessionRecord(server: "https://location.invalid", token: nil,
    userID: "owner", userName: "Fixture", mode: "disabled", ownershipID: "first")

  override func setUp() async throws {
    suite = "outcomego-location-" + UUID().uuidString
    defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    manager = HeldLocationManager()
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [LocationProtocol.self]
    let network = URLSession(configuration: config)
    sharing = LocationSharing(manager: manager, defaults: defaults, validate: { _ in },
      makeAPI: { try API(server: $0.server, session: network) })
    sharing.bind(owner)
  }
  override func tearDown() async throws {
    defaults.removePersistentDomain(forName: suite)
    sharing = nil; manager = nil; defaults = nil
  }
  private func pending() async throws -> Task<LocationSharing.Submission?, Error> {
    try await sharing.setEnabled(true, session: owner)
    let before = manager.requests
    let task = Task { try await sharing.prepare(session: owner) }
    let deadline = ContinuousClock.now + .seconds(3)
    while manager.requests == before, ContinuousClock.now < deadline {
      try await Task.sleep(for: .milliseconds(5))
    }
    XCTAssertGreaterThan(manager.requests, before)
    return task
  }
  func testConsentDefaultsOffWithoutRequestingGPS() async throws {
    let value = try await sharing.prepare(session: owner)
    XCTAssertNil(value)
    XCTAssertEqual(manager.requests, 0)
  }
  func testFixUsesRevisionEnvelope() async throws {
    let task = try await pending()
    manager.deliver()
    let returned = try await task.value
    let value = try XCTUnwrap(returned)
    let location = try XCTUnwrap(value.location)
    XCTAssertEqual(location.fix.device, "phone")
    XCTAssertEqual(location.fix.latitude, 47.6097)
    XCTAssertNotNil(UUID(uuidString: location.sharingRevision))
  }
  func testOptOutThenEnableCannotReviveEarlierSend() async throws {
    let task = try await pending()
    try await sharing.setEnabled(false, session: owner)
    try await sharing.setEnabled(true, session: owner)
    manager.deliver()
    do { _ = try await task.value; XCTFail("Old submission must be cancelled") }
    catch { XCTAssertTrue(error is CancellationError) }
  }
  func testAccountRoundTripCannotReviveEarlierSend() async throws {
    let task = try await pending()
    var next = owner
    next.ownershipID = "second"
    sharing.bind(next)
    sharing.bind(owner)
    manager.deliver()
    do { _ = try await task.value; XCTFail("Old account generation must be cancelled") }
    catch { XCTAssertTrue(error is CancellationError) }
  }
  func testPermissionLossCancelsWaitingFix() async throws {
    let task = try await pending()
    manager.revoke()
    manager.deliver()
    do { _ = try await task.value; XCTFail("Revoked permission must cancel the send") }
    catch { XCTAssertTrue(error is CancellationError) }
    XCTAssertFalse(sharing.enabled)
  }
}
