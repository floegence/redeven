import XCTest
@testable import RedevenComputerHost

final class AccessibilityTests: XCTestCase {
    func testIncompleteSafetyScanReportsTechnicalFailureWithoutInventingTakeover() throws {
        XCTAssertNoThrow(try validateNativeSafetyScan(remainingNodes: 0, confirmedReasons: []))
        XCTAssertThrowsError(try validateNativeSafetyScan(remainingNodes: 1, confirmedReasons: [])) { error in
            XCTAssertEqual((error as? HostFailure)?.code, "TARGET_OBSERVATION_UNAVAILABLE")
        }
        for reason in ["secret_input", "otp", "captcha", "app_permission", "user_control"] {
            XCTAssertNoThrow(try validateNativeSafetyScan(remainingNodes: 5001, confirmedReasons: [reason]))
        }
    }

    func testSemanticTextBudgetCountsScalarsWithoutSplittingUTF16() {
        let text = String(repeating: "e\u{301}🙂", count: 1000)
        let bounded = boundedAXText(text)
        XCTAssertEqual(bounded.unicodeScalars.count, 2000)
        XCTAssertEqual(bounded, String(String.UnicodeScalarView(text.unicodeScalars.prefix(2000))))
        XCTAssertEqual(boundedAXText("设置 🙂"), "设置 🙂")
    }
}
