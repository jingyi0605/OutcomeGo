import XCTest
@testable import OpenTeamCore

final class LiveVoiceSessionTests: XCTestCase {
  func testBargeInStopsCurrentGeneration() {
    let initial = LiveVoiceSnapshot(sessionID: "s", state: .speaking, generation: 3)
    let next = reduceLiveVoice(initial, command: .bargeIn(4))
    XCTAssertEqual(next.state, .interrupted)
    XCTAssertEqual(next.generation, 4)
  }

  func testFinalTranscriptMovesToProcessing() {
    let next = reduceLiveVoice(LiveVoiceSnapshot(sessionID: "s"), command: .final("hello"))
    XCTAssertEqual(next.state, .processing)
    XCTAssertEqual(next.partialTranscript, "hello")
  }
}
