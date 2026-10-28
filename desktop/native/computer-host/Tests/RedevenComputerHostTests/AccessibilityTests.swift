import XCTest
import ApplicationServices
@testable import RedevenComputerHost

final class AccessibilityTests: XCTestCase {
    func testUnavailableChildReadDoesNotBecomeAnEmptyLeaf() {
        XCTAssertThrowsError(try axChildren(AXUIElementCreateApplication(-1))) { error in
            XCTAssertEqual((error as? HostFailure)?.code, "TARGET_OBSERVATION_UNAVAILABLE")
        }
    }

    func testIncompleteSafetyScanReportsTechnicalFailureWithoutInventingTakeover() throws {
        XCTAssertNoThrow(try validateNativeSafetyScan(remainingNodes: 0, confirmedReasons: []))
        XCTAssertThrowsError(try validateNativeSafetyScan(remainingNodes: 1, confirmedReasons: [])) { error in
            XCTAssertEqual((error as? HostFailure)?.code, "TARGET_OBSERVATION_UNAVAILABLE")
        }
        for reason in ["secret_input", "otp", "captcha", "app_permission", "user_control"] {
            XCTAssertNoThrow(try validateNativeSafetyScan(remainingNodes: 5001, confirmedReasons: [reason]))
        }
    }

    func testFieldBudgetsPreserveIntegrityAndFullNameIdentity() {
        for character in ["x", "中", "🙂"] {
            for count in [1999, 2000, 2100] {
                let full = String(repeating: character, count: count)
                var output: [String: Any] = [:]
                for field in ["name", "description", "value"] {
                    setAXText(field, full, in: &output)
                    XCTAssertEqual(output[field] as? String, String(repeating: character, count: min(count, 2000)))
                    XCTAssertEqual(output[field + "_truncated"] as? Bool == true, count > 2000)
                }
                XCTAssertEqual(axNameIdentity(full), axNameIdentity(full))
                XCTAssertNotEqual(axNameIdentity(full + "A"), axNameIdentity(full + "B"))
            }
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
