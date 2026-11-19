import CoreLocation
import Foundation
import Observation
import SwiftUI

/// Local consent is per deployment/account. The server revision fences a late POST after opt-out.
@MainActor @Observable
final class LocationSharing: NSObject, CLLocationManagerDelegate {
  static let shared = LocationSharing()
  private(set) var enabled = false
  private(set) var available = false
  private(set) var changing = false
  private(set) var authorization: CLAuthorizationStatus
  private let manager: CLLocationManager
  private let defaults: UserDefaults
  private var session: SessionRecord?
  private var generation = UUID()
  private var generationStarted = Date()
  private var latest: CLLocation?
  private var answers = 0
  private var authorizationWaiters: [CheckedContinuation<Void, Never>] = []
  private let validate: @MainActor (SessionRecord) throws -> Void
  private let makeAPI: @MainActor (SessionRecord) throws -> API

  struct Submission: Sendable {
    let generation: UUID
    let location: LocationSubmission?
  }

  override convenience init() {
    self.init(manager: CLLocationManager())
  }

  init(manager: CLLocationManager, defaults: UserDefaults = .standard,
    validate: @escaping @MainActor (SessionRecord) throws -> Void = { try SystemIntentClient.validateSession($0) },
    makeAPI: @escaping @MainActor (SessionRecord) throws -> API = { try API(server: $0.server, token: $0.token, timeout: 3) }) {
    self.manager = manager
    self.defaults = defaults
    self.validate = validate
    self.makeAPI = makeAPI
    authorization = manager.authorizationStatus
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
  }

  var allowed: Bool { [.authorizedWhenInUse, .authorizedAlways].contains(authorization) }
  var denied: Bool { [.denied, .restricted].contains(authorization) }
  private func key(_ session: SessionRecord, _ suffix: String) -> String {
    "outcomego.location.\(SystemEntityID.scope(server: session.server, userID: session.userID)).\(suffix)"
  }
  private func matches(_ expected: SessionRecord) -> Bool {
    session?.sameCredentials(as: expected) == true
  }
  private func invalidate() {
    changing = false
    generation = UUID()
    generationStarted = Date()
    latest = nil
    manager.stopUpdatingLocation()
    let waiters = authorizationWaiters
    authorizationWaiters = []
    waiters.forEach { $0.resume() }
  }
  private func store(_ value: Bool) {
    enabled = value
    if let session { defaults.set(value, forKey: key(session, "enabled")) }
  }
  func bind(_ next: SessionRecord?) {
    if let previous = session, next == nil || !matches(next!) {
      if enabled { defaults.set(true, forKey: key(previous, "clearPending")) }
      store(false)
    }
    invalidate()
    session = next
    available = false
    changing = false
    enabled = next.map { defaults.bool(forKey: key($0, "enabled")) } ?? false
  }
  func useSession(_ next: SessionRecord) {
    if !matches(next) { bind(next) }
  }
  private func ensureCurrent(_ expected: SessionRecord, _ epoch: UUID) throws {
    try Task.checkCancellation()
    guard matches(expected), epoch == generation else { throw CancellationError() }
    try validate(expected)
  }
  private func api(_ session: SessionRecord) throws -> API {
    try makeAPI(session)
  }

  /// Server-disabled deployments expose no toggle and acquire no OS permission.
  func refreshAvailability(session expected: SessionRecord) async throws {
    let epoch = generation
    try ensureCurrent(expected, epoch)
    do {
      if defaults.bool(forKey: key(expected, "clearPending")) {
        _ = try await api(expected).request("/api/v0/location", method: "DELETE", timeout: 3)
        try ensureCurrent(expected, epoch)
        defaults.removeObject(forKey: key(expected, "clearPending"))
      }
      let state = try await api(expected).get("/api/v0/location", as: LocationSharingState.self, timeout: 3)
      try ensureCurrent(expected, epoch)
      available = true
      if !state.sharing.enabled, enabled { invalidate(); store(false) }
    } catch let error as APIError where error.status == 404 {
      try ensureCurrent(expected, epoch)
      available = false
      if enabled { invalidate() }
      store(false)
    }
  }

  func setEnabled(_ value: Bool, session expected: SessionRecord) async throws {
    guard matches(expected) else { throw CancellationError() }
    // Local cancellation precedes every permission/network await, including offline opt-out.
    invalidate()
    let epoch = generation
    store(false)
    changing = true
    defer { if epoch == generation { changing = false } }
    try ensureCurrent(expected, epoch)
    if !value {
      defaults.set(true, forKey: key(expected, "clearPending"))
      _ = try await api(expected).request("/api/v0/location", method: "DELETE", timeout: 3)
      try ensureCurrent(expected, epoch)
      defaults.removeObject(forKey: key(expected, "clearPending"))
      return
    }
    try await refreshAvailability(session: expected)
    try ensureCurrent(expected, epoch)
    guard available else { return }
    if authorization == .notDetermined {
      // Shortcuts never prompts for new permission; only an explicit foreground Settings action can.
      guard UIApplication.shared.applicationState == .active else { return }
      await withCheckedContinuation { continuation in
        authorizationWaiters.append(continuation)
        manager.requestWhenInUseAuthorization()
      }
    }
    try ensureCurrent(expected, epoch)
    guard allowed else { return }
    let state = try await api(expected).get("/api/v0/location", as: LocationSharingState.self, timeout: 3)
    try ensureCurrent(expected, epoch)
    guard UUID(uuidString: state.sharing.revision) != nil else { throw APIError("Invalid location sharing revision.") }
    _ = try await api(expected).request("/api/v0/location/sharing", method: "PUT", body: .object([
      "enabled": .bool(true), "expectedRevision": .string(state.sharing.revision),
    ]), timeout: 3)
    try ensureCurrent(expected, epoch)
    store(true)
    refresh()
  }

  func refresh() {
    guard enabled, allowed else { return }
    manager.requestLocation()
  }

  /// Optional, transient input. An opt-out while waiting cancels this send rather than reviving it.
  func prepare(session expected: SessionRecord) async throws -> Submission? {
    guard enabled else { return nil }
    let epoch = generation
    try ensureCurrent(expected, epoch)
    guard allowed else { return nil }
    let state = try await api(expected).get("/api/v0/location", as: LocationSharingState.self, timeout: 3)
    try ensureCurrent(expected, epoch)
    guard state.sharing.enabled else {
      invalidate()
      store(false)
      throw CancellationError()
    }
    guard UUID(uuidString: state.sharing.revision) != nil else { throw APIError("Invalid location sharing revision.") }
    if latest == nil || -(latest!.timestamp.timeIntervalSinceNow) >= 5 * 60 {
      let asked = answers
      manager.requestLocation()
      let deadline = ContinuousClock.now + .milliseconds(1_500)
      while answers == asked, ContinuousClock.now < deadline {
        try ensureCurrent(expected, epoch)
        try await Task.sleep(for: .milliseconds(50))
      }
    }
    try ensureCurrent(expected, epoch)
    guard enabled, allowed else { throw CancellationError() }
    guard let latest else { return Submission(generation: epoch, location: nil) }
    let fix = DeviceLocation(latitude: latest.coordinate.latitude, longitude: latest.coordinate.longitude,
      accuracyMeters: latest.horizontalAccuracy >= 0 ? min(latest.horizontalAccuracy, 10_000_000) : nil,
      capturedAt: latest.timestamp)
    return Submission(generation: epoch, location: LocationSubmission(fix: fix, sharingRevision: state.sharing.revision))
  }

  func perform<T: Sendable>(_ submission: Submission?, session expected: SessionRecord,
    operation: @escaping @Sendable () async throws -> T) async throws -> T {
    guard let submission else { return try await operation() }
    try ensureCurrent(expected, submission.generation)
    let request = Task { try await operation() }
    let watchdog = Task { @MainActor in
      while !Task.isCancelled {
        do {
          try ensureCurrent(expected, submission.generation)
          try await Task.sleep(for: .milliseconds(50))
        } catch { request.cancel(); return }
      }
    }
    defer { watchdog.cancel(); request.cancel() }
    return try await withTaskCancellationHandler {
      let result = try await request.value
      try ensureCurrent(expected, submission.generation)
      return result
    } onCancel: {
      request.cancel()
      watchdog.cancel()
    }
  }

  nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    MainActor.assumeIsolated {
      guard enabled, allowed else { return }
      if let newest = locations.filter({
        CLLocationCoordinate2DIsValid($0.coordinate) && $0.timestamp >= generationStarted
      }).max(by: { $0.timestamp < $1.timestamp }) { latest = newest }
      answers += 1
    }
  }
  nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    MainActor.assumeIsolated { answers += 1 }
  }
  nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    MainActor.assumeIsolated {
      let wasAllowed = allowed
      authorization = self.manager.authorizationStatus
      if !allowed, wasAllowed || enabled {
        let wasEnabled = enabled
        invalidate()
        store(false)
        if wasEnabled, let session {
          defaults.set(true, forKey: key(session, "clearPending"))
          Task { try? await self.refreshAvailability(session: session) }
        }
      }
      guard authorization != .notDetermined else { return }
      let waiters = authorizationWaiters
      authorizationWaiters = []
      waiters.forEach { $0.resume() }
    }
  }
}

struct LocationSharingSettings: View {
  @Environment(AppStore.self) private var store
  @State private var failure: String?
  private var sharing: LocationSharing { .shared }
  var body: some View {
    Group {
      if sharing.available {
        Section {
          Toggle("Share location", isOn: Binding(get: { sharing.enabled && sharing.allowed }, set: { value in
            Task {
              do { try await store.setLocationSharing(value); failure = nil }
              catch { failure = UserFacingError.message(error) }
            }
          })).disabled(sharing.changing).accessibilityIdentifier("share-location-toggle")
          if let failure { Text(failure).font(.footnote).foregroundStyle(.secondary) }
          if sharing.denied {
            Button("Allow location in iPhone Settings") {
              if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            }.accessibilityIdentifier("share-location-settings")
          }
        } footer: {
          Text("Messages sent from this iPhone can include its location. Turning sharing off forgets the server's saved location.")
        }
      }
    }.task { try? await store.refreshLocationSharing() }
  }
}
