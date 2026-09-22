import XCTest
@testable import RedevenComputerHost

final class HostApplicationHostTests: XCTestCase {
    func testChannelsRouteIndependentlyAndDetachOnlyTheirOwnSession() {
        var messages: [[String: Any]] = []
        let host = HostApplicationHost { messages.append($0) }
        let first = String(repeating: "a", count: 32), second = String(repeating: "b", count: 32)
        for id in [first, second] {
            host.handle(["protocol_version": 2, "session_id": id, "action": "configure", "mode": "invalid"])
        }
        XCTAssertEqual(messages.compactMap { $0["session_id"] as? String }, [first, second])
        XCTAssertEqual(messages.compactMap { $0["type"] as? String }, ["operation_error", "operation_error"])
        host.handle(["protocol_version": 2, "session_id": first, "action": "detach"])
        XCTAssertEqual(messages.last?["session_id"] as? String, first)
        XCTAssertEqual(messages.last?["type"] as? String, "ended")
        host.handle(["protocol_version": 2, "session_id": second, "action": "configure", "mode": "invalid"])
        XCTAssertEqual(messages.last?["session_id"] as? String, second)
        XCTAssertEqual(messages.last?["type"] as? String, "operation_error")
        let stopped = expectation(description: "Host drains sessions, including an already ended channel")
        host.end { stopped.fulfill() }
        wait(for: [stopped], timeout: 1)
        XCTAssertEqual(messages.filter { $0["type"] as? String == "ended" }.count, 2)
    }

    func testOldProtocolCannotDetachAnActiveChannel() {
        var messages: [[String: Any]] = []
        let host = HostApplicationHost { messages.append($0) }
        let id = String(repeating: "a", count: 32)
        host.handle(["protocol_version": 2, "session_id": id, "action": "configure", "mode": "invalid"])
        host.handle(["protocol_version": 1, "session_id": id, "action": "detach"])
        XCTAssertEqual(messages.last?["code"] as? String, "UNSUPPORTED_PROTOCOL")
        XCTAssertFalse(messages.contains { $0["type"] as? String == "ended" })
        host.handle(["protocol_version": 2, "session_id": id, "action": "detach"])
        XCTAssertEqual(messages.last?["type"] as? String, "ended")
    }
}
