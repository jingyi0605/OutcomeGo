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
    XCTAssertEqual(next.partialTranscript, "")
  }
}

final class LiveVoiceGroupCallTests: XCTestCase {
  func testPartialTranscriptMarksTheUserAsSpeakingUntilItIsFinal() {
    var snapshot = LiveVoiceSnapshot(sessionID: "s")
    snapshot = reduceLiveVoice(snapshot, command: .partial("你们两个"))
    XCTAssertTrue(snapshot.userSpeaking)
    snapshot = reduceLiveVoice(snapshot, command: .final("你们两个各说一句"))
    XCTAssertFalse(snapshot.userSpeaking)
  }

  func testAnEmptyPartialWithdrawsATurnTheServerDiscardedAsNoise() {
    var snapshot = LiveVoiceSnapshot(sessionID: "s", userSpeaking: true)
    snapshot = reduceLiveVoice(snapshot, command: .partial(""))
    XCTAssertFalse(snapshot.userSpeaking)
  }

  func testBargeInAndStopClearWhoIsSpeaking() {
    let speaking = LiveVoiceSnapshot(sessionID: "s", state: .speaking, generation: 3, speakerBotID: "bot-a")
    XCTAssertNil(reduceLiveVoice(speaking, command: .bargeIn(4)).speakerBotID)
    XCTAssertNil(reduceLiveVoice(speaking, command: .stopped(4)).speakerBotID)
  }

  func testTranscriptLineRemembersWhichBotSpoke() {
    let line = LiveVoiceTranscript(id: "m1", role: .assistant, text: "我站正方。", speakerBotID: "bot-a")
    XCTAssertEqual(line.speakerBotID, "bot-a")
    XCTAssertNil(LiveVoiceTranscript(id: "u1", role: .user, text: "hi").speakerBotID)
  }
}
