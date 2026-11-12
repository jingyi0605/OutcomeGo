import Foundation
import Observation
import UIKit

@MainActor @Observable
final class MobileUpdates {
  private(set) var release: MobileRelease?
  private(set) var openingTestFlight = false
  private(set) var openError: String?
  private var lastChecked: Date?
  private var checking = false
  private let cacheKey = "outcomego.mobile-release"
  private let installedVersion: String
  private let installedBuild: String

  var availableRelease: MobileRelease? {
    guard let release, release.isNewer(thanVersion: installedVersion, buildNumber: installedBuild)
    else { return nil }
    return release
  }

  init() {
    installedVersion =
      Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    installedBuild = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
    if let data = UserDefaults.standard.data(forKey: cacheKey),
      let cached = try? JSONDecoder().decode(MobileRelease.self, from: data), cached.isValid
    {
      release = cached
    }
    #if DEBUG
      if ProcessInfo.processInfo.arguments.contains("--ui-testing") {
        release = nil
        if ProcessInfo.processInfo.arguments.contains("--qa-mobile-update") {
          release = MobileRelease(
            version: "0.2.0", buildNumber: "51",
            bundleIdentifier: MobileRelease.expectedBundleIdentifier)
        }
      }
    #endif
  }

  func refresh() async {
    #if DEBUG
      if ProcessInfo.processInfo.arguments.contains("--ui-testing") { return }
    #endif
    guard let feedURL = MobileRelease.feedURL else { return }
    guard !checking, lastChecked.map({ Date().timeIntervalSince($0) >= 15 * 60 }) ?? true
    else { return }
    checking = true
    lastChecked = Date()
    defer { checking = false }
    do {
      // Keep release discovery separate from the authenticated server session.
      let configuration = URLSessionConfiguration.ephemeral
      configuration.httpShouldSetCookies = false
      configuration.timeoutIntervalForRequest = 10
      configuration.timeoutIntervalForResource = 15
      let session = URLSession(configuration: configuration)
      defer { session.invalidateAndCancel() }
      let (data, response) = try await session.data(from: feedURL)
      guard let response = response as? HTTPURLResponse, response.statusCode == 200 else { return }
      let next = try MobileReleaseFeed.decode(data)
      guard !Task.isCancelled else { return }
      release = next
      if let next, let data = try? JSONEncoder().encode(next) {
        UserDefaults.standard.set(data, forKey: cacheKey)
      } else {
        UserDefaults.standard.removeObject(forKey: cacheKey)
      }
    } catch {
      // Offline checks retain the last published release without interrupting work.
    }
  }

  func openTestFlight() async {
    guard !openingTestFlight else { return }
    openingTestFlight = true
    openError = nil
    defer { openingTestFlight = false }
    #if DEBUG
      if ProcessInfo.processInfo.arguments.contains("--ui-testing") {
        // Exercise the action without leaving the UI-test app for another app.
        UserDefaults.standard.set(
          MobileRelease.downloadURL?.absoluteString ?? "none", forKey: "qa-testflight-url")
        return
      }
    #endif
    if let url = MobileRelease.downloadURL, await UIApplication.shared.open(url) { return }
    openError = "Could not open the download page. Try again."
  }
}
