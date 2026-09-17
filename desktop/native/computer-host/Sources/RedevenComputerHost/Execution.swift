import Foundation
import CoreGraphics

// The stdin reader can cancel while the main run loop is executing a request.
// There is one admitted request, with no queued input or resumable program.
final class NativeExecution {
    private let lock = NSLock()
    private var active: String?
    private var cancelled = false

    func begin(_ requestID: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard active == nil else { return false }
        active = requestID; cancelled = false
        return true
    }
    func cancel(_ requestID: String? = nil) {
        lock.lock()
        if requestID == nil || active == requestID { cancelled = true }
        lock.unlock()
        CFRunLoopWakeUp(CFRunLoopGetMain())
    }
    func finish(_ requestID: String) {
        lock.lock(); defer { lock.unlock() }
        if active == requestID { active = nil }
    }
    func check() throws {
        lock.lock(); let stopped = cancelled; lock.unlock()
        if stopped { throw HostFailure(code: "CANCELLED", message: "Computer execution was cancelled.") }
    }
}

// Retain only releases for input actually posted by this helper. Cleanup never
// synthesizes a new press, carries text, or moves the user's pointer.
struct NativePendingInput {
    private var releases: [String: CGEvent] = [:]

    mutating func posted(_ event: CGEvent) {
        var key: String?
        var release: CGEvent?
        switch event.type {
        case .keyDown:
            let code = event.getIntegerValueField(.keyboardEventKeycode)
            key = "key:\(code)"
            release = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(code), keyDown: false)
        case .keyUp: releases.removeValue(forKey: "key:\(event.getIntegerValueField(.keyboardEventKeycode))")
        case .leftMouseDown, .rightMouseDown, .otherMouseDown:
            let button = event.getIntegerValueField(.mouseEventButtonNumber)
            key = "button:\(button)"
            release = event.copy()
            release?.type = event.type == .leftMouseDown ? .leftMouseUp : event.type == .rightMouseDown ? .rightMouseUp : .otherMouseUp
        case .leftMouseUp, .rightMouseUp, .otherMouseUp:
            releases.removeValue(forKey: "button:\(event.getIntegerValueField(.mouseEventButtonNumber))")
        default: break
        }
        if let key, let release { release.flags = []; releases[key] = release }
    }

    mutating func takeReleases(at pointer: CGPoint, flags: CGEventFlags = []) -> [CGEvent] {
        let events = Array(releases.values)
        releases.removeAll()
        for event in events {
            event.flags = flags
            if event.type != .keyUp { event.location = pointer }
        }
        return events
    }
}
