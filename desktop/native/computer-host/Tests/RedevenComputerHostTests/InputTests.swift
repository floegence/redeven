import XCTest
import CoreGraphics
@testable import RedevenComputerHost

final class InputTests: XCTestCase {
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
        let event = try NativeInput.scroll(x: 10, y: 600, naturalScrolling: false)[0]
        XCTAssertLessThan(event.getIntegerValueField(.scrollWheelEventPointDeltaAxis1), 0)
        XCTAssertLessThan(event.getIntegerValueField(.scrollWheelEventPointDeltaAxis2), 0)
        let natural = try NativeInput.scroll(x: 10, y: 600, naturalScrolling: true)[0]
        XCTAssertGreaterThan(natural.getIntegerValueField(.scrollWheelEventPointDeltaAxis1), 0)
        XCTAssertGreaterThan(natural.getIntegerValueField(.scrollWheelEventPointDeltaAxis2), 0)
        XCTAssertThrowsError(try NativeInput.scroll(x: .infinity, y: 0, naturalScrolling: false))
        XCTAssertThrowsError(try NativeInput.scroll(x: 0, y: 1e20, naturalScrolling: true))
    }
}

    func testDragProducesBalancedPath() throws {
        let events = try NativeInput.drag(from: CGPoint(x: 10, y: 20), to: CGPoint(x: 110, y: 120), durationMilliseconds: 64)
        XCTAssertEqual(events.first?.type, .mouseMoved)
        XCTAssertEqual(events.dropFirst().first?.type, .leftMouseDown)
        XCTAssertEqual(events.last?.type, .leftMouseUp)
        XCTAssertGreaterThan(events.count, 4)
    }
