import XCTest
import ApplicationServices
import AppKit
@testable import RedevenComputerHost

final class AccessibilityTests: XCTestCase {
    func testPausePreservesObservedReasonsWithoutInventingUserIntent() {
        let app = NSRunningApplication.current
        let element = AXUIElementCreateApplication(app.processIdentifier)
        let window = NativeWindow(app: app, application: element, element: element, windowID: 42)
        for reason in ["target_focus_changed", "input_monitor_unavailable", "secret_input", "foreground_permission", "user_control"] {
            let revision = window.revision
            window.pause([reason])
            XCTAssertTrue(window.isPaused)
            XCTAssertEqual(window.pauseReasons, [reason])
            XCTAssertGreaterThan(window.revision, revision)
            window.resumeObservation()
            XCTAssertFalse(window.isPaused)
            XCTAssertTrue(window.pauseReasons.isEmpty)
        }
        window.pause(["target_focus_changed"])
        window.pause(["input_monitor_unavailable"])
        XCTAssertEqual(window.pauseReasons, ["target_focus_changed", "input_monitor_unavailable"])
        XCTAssertFalse(window.pauseReasons.contains("user_control"))
    }

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
