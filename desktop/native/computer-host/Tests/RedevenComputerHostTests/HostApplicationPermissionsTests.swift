import XCTest
@testable import RedevenComputerHost

final class HostApplicationPermissionsTests: XCTestCase {
    func testPermissionAdapterPreservesExplicitUpstreamOperation() throws {
        for operation in ["screen_recording", "accessibility", "screen_recording_settings", "accessibility_settings", "reveal_application"] {
            var calls: [String] = []
            try HostApplicationPermissions.perform(operation, apply: { calls.append($0) })
            XCTAssertEqual(calls, [operation])
        }
    }
    func testPermissionFailurePropagatesWithoutRetry() {
        enum Failure: Error { case denied }
        var calls = 0
        XCTAssertThrowsError(try HostApplicationPermissions.perform("screen_recording", apply: { _ in calls += 1; throw Failure.denied }))
        XCTAssertEqual(calls, 1)
    }
}
