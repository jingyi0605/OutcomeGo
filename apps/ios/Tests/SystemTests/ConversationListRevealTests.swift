import XCTest
@testable import OutcomeGoNative

@MainActor final class ConversationListRevealTests: XCTestCase {
  func testClearingAnInterruptedRevealInvalidatesItsSettle() {
    let reveal = ListReveal()
    XCTAssertNil(reveal.width)
    reveal.drag(to: 120)
    let settling = reveal.drags
    reveal.drag(to: 160)
    XCTAssertGreaterThan(reveal.drags, settling)
    XCTAssertEqual(reveal.width, 160)
    reveal.clear()
    XCTAssertNil(reveal.width)
    XCTAssertGreaterThan(reveal.drags, settling)
  }
}
