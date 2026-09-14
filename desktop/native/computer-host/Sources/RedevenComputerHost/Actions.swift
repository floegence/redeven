import ApplicationServices
import Foundation

struct HostFailure: Error {
    let code: String
    let message: String
}

// Event construction is separate from posting so tests can inspect the actual
// CGEvent sequence without sending input to the user's focused application.
enum NativeInput {
    static func click(at point: CGPoint, count: Int) throws -> [CGEvent] {
        // Mouse button event coordinates do not move the system pointer.
        // Move first so a subsequent wheel event reaches this same viewport.
        guard let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                                 mouseCursorPosition: point, mouseButton: .left) else {
            throw unavailable()
        }
        var events: [CGEvent] = [move]
        for index in 1...count {
            for type: CGEventType in [.leftMouseDown, .leftMouseUp] {
                guard let event = CGEvent(mouseEventSource: nil, mouseType: type,
                                          mouseCursorPosition: point, mouseButton: .left) else {
                    throw unavailable()
                }
                event.setIntegerValueField(.mouseEventClickState, value: Int64(index))
                events.append(event)
            }
        }
        return events
    }

    static func scroll(x: Double, y: Double, naturalScrolling: Bool) throws -> [CGEvent] {
        guard x.isFinite, y.isFinite, abs(x) <= 100_000, abs(y) <= 100_000 else {
            throw invalid("Scroll deltas must be finite viewport pixels.")
        }
        // macOS applies the user's natural-scrolling preference to posted
        // wheel events. Compensate once so positive viewport deltas always
        // move down/right, matching the browser target.
        let direction = naturalScrolling ? 1.0 : -1.0
        guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel,
                                  wheelCount: 2, wheel1: Int32(direction * y), wheel2: Int32(direction * x), wheel3: 0) else {
            throw unavailable()
        }
        return [event]
    }

    static func text(_ text: String) throws -> [CGEvent] {
        guard text.count <= 20_000 else { throw invalid("Text exceeds the tool limit.") }
        var events: [CGEvent] = []
        for character in text {
            let units = Array(String(character).utf16)
            // CGEvent supports at most 20 UTF-16 units. Split oversized grapheme
            // clusters by scalar boundaries without splitting surrogate pairs.
            var chunk: [UniChar] = []
            func appendChunk() throws {
                guard !chunk.isEmpty else { return }
                for down in [true, false] {
                    guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down) else {
                        throw unavailable()
                    }
                    chunk.withUnsafeBufferPointer {
                        event.keyboardSetUnicodeString(stringLength: $0.count, unicodeString: $0.baseAddress!)
                    }
                    events.append(event)
                }
                chunk.removeAll(keepingCapacity: true)
            }
            if units.count <= 20 {
                chunk = units
            } else {
                for scalar in String(character).unicodeScalars {
                    let next = Array(String(scalar).utf16)
                    if chunk.count + next.count > 20 { try appendChunk() }
                    chunk.append(contentsOf: next)
                }
            }
            try appendChunk()
        }
        return events
    }

    static func key(_ chord: String) throws -> [CGEvent] {
        var parts = chord.split(separator: "+", omittingEmptySubsequences: false).map { String($0).lowercased() }
        guard let key = parts.popLast(), !key.isEmpty else { throw invalid("A key is required.") }
        var flags: CGEventFlags = []
        for modifier in parts {
            switch modifier {
            case "cmd", "command", "meta": flags.insert(.maskCommand)
            case "ctrl", "control": flags.insert(.maskControl)
            case "alt", "option": flags.insert(.maskAlternate)
            case "shift": flags.insert(.maskShift)
            default: throw invalid("Unsupported keyboard modifier.")
            }
        }
        let codes: [String: CGKeyCode] = [
            "a":0,"s":1,"d":2,"f":3,"h":4,"g":5,"z":6,"x":7,"c":8,"v":9,
            "b":11,"q":12,"w":13,"e":14,"r":15,"y":16,"t":17,"1":18,"2":19,
            "3":20,"4":21,"6":22,"5":23,"=":24,"9":25,"7":26,"-":27,"8":28,
            "0":29,"]":30,"o":31,"u":32,"[":33,"i":34,"p":35,"enter":36,"return":36,
            "l":37,"j":38,"'":39,"k":40,";":41,"\\":42,",":43,"/":44,"n":45,"m":46,
            ".":47,"tab":48,"space":49," ":49,"`":50,"backspace":51,"escape":53,"esc":53,
            "delete":117,"home":115,"end":119,"pageup":116,"pagedown":121,
            "arrowleft":123,"left":123,"arrowright":124,"right":124,"arrowdown":125,
            "down":125,"arrowup":126,"up":126,
            "f1":122,"f2":120,"f3":99,"f4":118,"f5":96,"f6":97,"f7":98,"f8":100,
            "f9":101,"f10":109,"f11":103,"f12":111,
        ]
        guard let code = codes[key] else { throw invalid("Unsupported key; use computer.type for text.") }
        return try [true, false].map { down in
            guard let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down) else {
                throw unavailable()
            }
            event.flags = flags
            return event
        }
    }

    static func invalid(_ message: String) -> HostFailure { HostFailure(code: "INVALID_ARGUMENT", message: message) }
    static func unavailable() -> HostFailure { HostFailure(code: "TARGET_NOT_READY", message: "macOS could not create an input event.") }
}
