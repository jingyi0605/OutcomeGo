import Foundation

/// Exported URLs can be consumed after the App Intent/Share Sheet has returned.
/// Keep them outside purgeable temporary storage until explicit account cleanup.
enum SystemTransferFiles {
  static var root: URL {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("OutcomeGo/Transfers", isDirectory: true)
  }

  static func createExport(scope: String, fileName: String, root: URL = SystemTransferFiles.root) throws -> URL {
    guard scope.count == 64, scope.allSatisfy({ "0123456789abcdef".contains($0) }) else {
      throw APIError("Invalid attachment account scope.")
    }
    let account = root.appendingPathComponent(scope, isDirectory: true)
    let directory = account.appendingPathComponent(UUID().uuidString, isDirectory: true)
    for folder in [root, account, directory] {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700, .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    }
    var excluded = root
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try excluded.setResourceValues(values)
    let leaf = URL(fileURLWithPath: fileName).lastPathComponent
    return directory.appendingPathComponent(["", ".", ".."].contains(leaf) ? "Attachment" : leaf)
  }

  static func finishExport(_ url: URL) throws {
    try FileManager.default.setAttributes([
      .posixPermissions: 0o600, .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication,
    ], ofItemAtPath: url.path)
  }

  /// Capture individual handoffs before asynchronous index cleanup starts.
  /// A new export, even for the same account, must not be removed by an older cleanup.
  static func retiring(scope: String?, root: URL = SystemTransferFiles.root, legacy: URL? = nil) -> [URL] {
    var parents: [URL] = []
    if let scope, scope.count == 64, scope.allSatisfy({ "0123456789abcdef".contains($0) }) {
      parents.append(root.appendingPathComponent(scope, isDirectory: true))
    }
    if let legacy { parents.append(legacy) }
    return parents.flatMap {
      (try? FileManager.default.contentsOfDirectory(at: $0, includingPropertiesForKeys: nil)) ?? []
    }
  }
}
