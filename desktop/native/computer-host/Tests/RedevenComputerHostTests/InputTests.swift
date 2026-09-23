import XCTest
import CoreGraphics
@testable import RedevenComputerHost

final class InputTests: XCTestCase {
    func testViewerKeysPreservePressReleaseRepeatAndClientCharacters() throws {
        let base: [String: Any] = ["key":"j", "code":"KeyJ", "pressed":true, "repeat":true,
                                  "shiftKey":false, "ctrlKey":false, "altKey":false, "metaKey":false]
        let down = try NativeInput.viewerKey(base)
        XCTAssertEqual(down.type, .keyDown)
        XCTAssertEqual(down.getIntegerValueField(.keyboardEventAutorepeat), 1)
        var units = [UniChar](repeating: 0, count: 20), length = 0
        down.keyboardGetUnicodeString(maxStringLength: 20, actualStringLength: &length, unicodeString: &units)
        XCTAssertEqual(String(decoding: units.prefix(length), as: UTF16.self), "j")
        var released = base; released["pressed"] = false; released["repeat"] = false
        XCTAssertEqual(try NativeInput.viewerKey(released).type, .keyUp)
        var modifier = base; modifier["key"] = "Shift"; modifier["code"] = "ShiftRight"; modifier["shiftKey"] = true
        XCTAssertEqual(try NativeInput.viewerKey(modifier).type, .flagsChanged)
        XCTAssertThrowsError(try NativeInput.viewerKey(["key":"Enter"]))
    }
    func testCancellationReleasesOnlyPostedInputAtCurrentPointer() throws {
        var pending = NativePendingInput()
        let clicks = try NativeInput.click(at: CGPoint(x: 30, y: 40), count: 1)
        pending.posted(clicks[0]); pending.posted(clicks[1])
        let chord = try NativeInput.key("Meta+a")
        pending.posted(chord[0])
        let releases = pending.takeReleases(at: CGPoint(x: 200, y: 210))
        XCTAssertEqual(Set(releases.map { $0.type.rawValue }), Set([CGEventType.leftMouseUp.rawValue, CGEventType.keyUp.rawValue]))
        XCTAssertEqual(releases.first(where: { $0.type == .leftMouseUp })?.location, CGPoint(x: 200, y: 210))
        XCTAssertTrue(releases.allSatisfy { $0.flags.isEmpty })
        XCTAssertTrue(pending.takeReleases(at: .zero).isEmpty)
        for event in clicks + chord { pending.posted(event) }
        XCTAssertTrue(pending.takeReleases(at: .zero).isEmpty)
    }

    func testCancellationIsScopedToAdmittedRequest() throws {
        let execution = NativeExecution()
        XCTAssertTrue(execution.begin("one"))
        XCTAssertFalse(execution.begin("two"))
        execution.cancel("two")
        XCTAssertNoThrow(try execution.check())
        execution.cancel("one")
        XCTAssertThrowsError(try execution.check())
        execution.finish("one")
        XCTAssertTrue(execution.begin("two"))
        XCTAssertNoThrow(try execution.check())
        execution.cancel()
        XCTAssertThrowsError(try execution.check())
    }

    func testInvalidExclusionNeverBecomesUnrestrictedCapture() throws {
        let key = "REDEVEN_COMPUTER_EXCLUDED_WINDOW_OWNER_PID"
        for value in ["", "not-a-pid", "0", "-1", "2147483648"] {
            XCTAssertThrowsError(try NativeScreenCapture.excludedOwner(environment: [key: value]))
        }
        XCTAssertEqual(try NativeScreenCapture.excludedOwner(environment: [key: "123"]), 123)
        XCTAssertNil(try NativeScreenCapture.excludedOwner(environment: [:]))
    }

    func testDoubleClickHasBalancedButtonsAndClickCount() throws {
        let events = try NativeInput.click(at: CGPoint(x: 30, y: 40), count: 2)
        XCTAssertEqual(events.map(\.type), [.mouseMoved, .leftMouseDown, .leftMouseUp, .leftMouseDown, .leftMouseUp])
        XCTAssertEqual(events.dropFirst().map { $0.getIntegerValueField(.mouseEventClickState) }, [1, 1, 2, 2])
        XCTAssertTrue(events.allSatisfy { $0.location == CGPoint(x: 30, y: 40) })
    }
    func testChordPreservesModifiersAndDistinguishesDelete() throws {
        let events = try NativeInput.key("Meta+Shift+a")
        XCTAssertEqual(events.map(\.type), [.keyDown, .keyUp])
        XCTAssertTrue(events.allSatisfy { $0.flags.contains([.maskCommand, .maskShift]) })
        XCTAssertEqual(try NativeInput.key("Delete")[0].getIntegerValueField(.keyboardEventKeycode), 117)
        XCTAssertEqual(try NativeInput.key("Backspace")[0].getIntegerValueField(.keyboardEventKeycode), 51)
        XCTAssertThrowsError(try NativeInput.key("Hyper+a"))
        XCTAssertThrowsError(try NativeInput.key("Unknown"))
    }
    func testUnicodeTextIncludesBothKeyEventsWithoutSplittingSurrogates() throws {
        let text = "A\u{1F600}\u{4E2D}"
        let events = try NativeInput.text(text)
        XCTAssertEqual(events.count, 6)
        var decoded = ""
        for index in stride(from: 0, to: events.count, by: 2) {
            var units = [UniChar](repeating: 0, count: 20)
            var length = 0
            events[index].keyboardGetUnicodeString(maxStringLength: 20, actualStringLength: &length, unicodeString: &units)
            decoded += String(decoding: units.prefix(length), as: UTF16.self)
            XCTAssertEqual(events[index].type, .keyDown)
            XCTAssertEqual(events[index + 1].type, .keyUp)
        }
        XCTAssertEqual(decoded, text)
    }
    func testScrollUsesViewportDirectionAndRejectsOverflow() throws {
        let point = CGPoint(x: 300, y: 400)
        let events = try NativeInput.scroll(at: point, x: 10, y: 600, naturalScrolling: false)
        XCTAssertEqual(events.map(\.type), [.mouseMoved, .scrollWheel])
        XCTAssertTrue(events.allSatisfy { $0.location == point })
        let event = events[1]
        XCTAssertLessThan(event.getIntegerValueField(.scrollWheelEventPointDeltaAxis1), 0)
        XCTAssertLessThan(event.getIntegerValueField(.scrollWheelEventPointDeltaAxis2), 0)
        let natural = try NativeInput.scroll(at: point, x: 10, y: 600, naturalScrolling: true)[1]
        XCTAssertGreaterThan(natural.getIntegerValueField(.scrollWheelEventPointDeltaAxis1), 0)
        XCTAssertGreaterThan(natural.getIntegerValueField(.scrollWheelEventPointDeltaAxis2), 0)
        XCTAssertThrowsError(try NativeInput.scroll(at: point, x: .infinity, y: 0, naturalScrolling: false))
        XCTAssertThrowsError(try NativeInput.scroll(at: point, x: 0, y: 1e20, naturalScrolling: true))
    }

    func testDragProducesBalancedPath() throws {
        let events = try NativeInput.drag(from: CGPoint(x: 10, y: 20), to: CGPoint(x: 110, y: 120), durationMilliseconds: 64)
        XCTAssertEqual(events.first?.type, .mouseMoved)
        XCTAssertEqual(events.dropFirst().first?.type, .leftMouseDown)
        XCTAssertEqual(events.last?.type, .leftMouseUp)
        XCTAssertGreaterThan(events.count, 4)
    }
}
