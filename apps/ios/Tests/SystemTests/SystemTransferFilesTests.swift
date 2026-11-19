import XCTest
@testable import OutcomeGoNative

/// Source-only regression definitions. Execute on the later full-Xcode acceptance host.
@MainActor final class SystemTransferFilesTests: XCTestCase {
  func testPDFBytesRemainAfterHandoffAndDoNotUseTemporaryStorage() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let scope = String(repeating: "a", count: 64)
    let first = try SystemTransferFiles.createExport(scope: scope, fileName: "../report.pdf", root: root)
    let second = try SystemTransferFiles.createExport(scope: scope, fileName: "report.pdf", root: root)
    let bytes = Data("%PDF-1.7\nfixture".utf8)
    try bytes.write(to: first)
    try SystemTransferFiles.finishExport(first)
    XCTAssertEqual(first.lastPathComponent, "report.pdf")
    XCTAssertNotEqual(first, second)
    XCTAssertEqual(try Data(contentsOf: first), bytes)
    let attributes = try FileManager.default.attributesOfItem(atPath: first.path)
    XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
    XCTAssertTrue(SystemTransferFiles.root.path.contains("Application Support/OutcomeGo/Transfers"))
  }

  func testOldCleanupCannotRemoveNewOrOtherAccountExports() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let scope = String(repeating: "a", count: 64)
    let old = try SystemTransferFiles.createExport(scope: scope, fileName: "old.pdf", root: root)
    try Data([1]).write(to: old)
    let retiring = SystemTransferFiles.retiring(scope: scope, root: root)
    let fresh = try SystemTransferFiles.createExport(scope: scope, fileName: "new.pdf", root: root)
    let other = try SystemTransferFiles.createExport(scope: String(repeating: "b", count: 64), fileName: "other.pdf", root: root)
    try Data([2]).write(to: fresh)
    try Data([3]).write(to: other)
    for directory in retiring { try FileManager.default.removeItem(at: directory) }
    XCTAssertFalse(FileManager.default.fileExists(atPath: old.path))
    XCTAssertEqual(try Data(contentsOf: fresh), Data([2]))
    XCTAssertEqual(try Data(contentsOf: other), Data([3]))
    XCTAssertThrowsError(try SystemTransferFiles.createExport(scope: "../escape", fileName: "x.pdf", root: root))
  }
}
