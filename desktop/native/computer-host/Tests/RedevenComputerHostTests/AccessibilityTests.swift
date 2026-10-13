import XCTest
@testable import RedevenComputerHost

final class AccessibilityTests: XCTestCase {
    func testSemanticTextBudgetCountsScalarsWithoutSplittingUTF16() {
        let text = String(repeating: "e\u{301}🙂", count: 1000)
        let bounded = boundedAXText(text)
        XCTAssertEqual(bounded.unicodeScalars.count, 2000)
        XCTAssertEqual(bounded, String(String.UnicodeScalarView(text.unicodeScalars.prefix(2000))))
        XCTAssertEqual(boundedAXText("设置 🙂"), "设置 🙂")
    }
}
