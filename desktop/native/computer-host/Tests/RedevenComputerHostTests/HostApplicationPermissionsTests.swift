import XCTest
@testable import RedevenComputerHost

final class HostApplicationPermissionsTests: XCTestCase {
    func testRequestRegistersMissingPermissionAndOpensItsPaneWhenNotGranted() throws {
        for permission in ["screen_recording", "accessibility"] {
            for granted in [false, true] {
                var calls: [String] = []
                try HostApplicationPermissions.perform(permission,
                    screen: { calls.append("screen_recording"); return granted },
                    input: { calls.append("accessibility"); return granted },
                    open: { calls.append($0.absoluteString); return true })
                XCTAssertEqual(calls.first, permission)
                XCTAssertEqual(calls.count, granted ? 1 : 2)
                if !granted { XCTAssertTrue(calls.last!.hasSuffix(permission == "screen_recording" ? "Privacy_ScreenCapture" : "Privacy_Accessibility")) }
            }
        }
    }
    func testManagementDoesNotRequestPermissionAndPropagatesOpenFailure() throws {
        for permission in ["screen_recording_settings", "accessibility_settings"] {
            var requested = false
            XCTAssertThrowsError(try HostApplicationPermissions.perform(permission, screen: { requested = true; return false }, input: { requested = true; return false }, open: { _ in false }))
            XCTAssertFalse(requested)
        }
    }
    func testUnknownPermissionHasNoEffect() {
        var effects = 0
        XCTAssertThrowsError(try HostApplicationPermissions.perform("camera", screen: { effects += 1; return false }, input: { effects += 1; return false }, open: { _ in effects += 1; return true }))
        XCTAssertEqual(effects, 0)
    }
}
