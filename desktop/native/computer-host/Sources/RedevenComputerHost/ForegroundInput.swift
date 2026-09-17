import AppKit
import ApplicationServices

// Marked events acknowledge delivery; other input only suppresses optional
// focus restoration. Explicit Stop/takeover owns pausing. Key contents are never read.
final class NativeForegroundInput {
    static let eventMarker = Int64.random(in: 1...Int64.max)
    var target: NativeWindow?
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var pending = NativePendingInput()
    private var delivered = 0
    private(set) var inputCount = 0

    init() {
        let types: [CGEventType] = [.keyDown, .keyUp, .flagsChanged, .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp,
                                   .mouseMoved, .leftMouseDragged, .rightMouseDragged, .scrollWheel]
        let mask = types.reduce(CGEventMask(0)) { $0 | (1 << $1.rawValue) }
        tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask, callback: { _, type, event, pointer in
            guard let pointer else { return Unmanaged.passUnretained(event) }
            let guardState = Unmanaged<NativeForegroundInput>.fromOpaque(pointer).takeUnretainedValue()
            if event.getIntegerValueField(.eventSourceUserData) == NativeForegroundInput.eventMarker { guardState.delivered += 1 }
            else { guardState.inputCount += 1 }
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                guardState.target?.userInControl = true
                guardState.target?.invalidate()
                return Unmanaged.passUnretained(event)
            }
            return Unmanaged.passUnretained(event)
        }, userInfo: Unmanaged.passUnretained(self).toOpaque())
        if let tap {
            source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
            if let source { CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes) }
            CGEvent.tapEnable(tap: tap, enable: true)
        }
    }

    deinit {
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
    }

    var available: Bool { tap.map { CGEvent.tapIsEnabled(tap: $0) } ?? false }

    func post(_ events: [CGEvent], window: NativeWindow, allowed: Bool, privateInput: Bool, activate: Bool = true, started: () -> Void, prepare: () throws -> Void, didPost: () -> Void) throws {
        try execution.check()
        guard available else { throw HostFailure(code: "TARGET_PERMISSION_REQUIRED", message: "Allow input monitoring before foreground control.") }
        guard allowed || privateInput else { throw HostFailure(code: "FOREGROUND_PERMISSION_REQUIRED", message: "Allow temporary foreground use for this task.") }
        try window.validate()
        guard !window.userInControl || privateInput else { throw HostFailure(code: "TAKEOVER_REQUIRED", message: "Automation is paused. Return control in Flower to continue.") }
        let original = NSWorkspace.shared.frontmostApplication
        let originalWindow = original.flatMap { axValue(AXUIElementCreateApplication($0.processIdentifier), kAXFocusedWindowAttribute) }
        let originalPointer = CGEvent(source: nil)?.location
        target = window
        let initialInputCount = inputCount
        started()
        defer {
            // Complete only outstanding releases, even after user intervention.
            for release in pending.takeReleases(at: CGEvent(source: nil)?.location ?? .zero, flags: CGEventSource.flagsState(.hidSystemState)) {
                release.setIntegerValueField(.eventSourceUserData, value: Self.eventMarker)
                release.post(tap: .cghidEventTap)
            }
            // Focus restoration is conditional. Never override an intervening
            // user action or a window that disappeared during the operation.
            if inputCount == initialInputCount && !window.userInControl && !privateInput,
               NSWorkspace.shared.frontmostApplication?.processIdentifier == window.app.processIdentifier,
               let original, !original.isTerminated,
               let originalWindow, CFGetTypeID(originalWindow) == AXUIElementGetTypeID() {
                let element = unsafeBitCast(originalWindow, to: AXUIElement.self)
                if !axString(element, kAXRoleAttribute).isEmpty {
                    original.activate(options: [])
                    AXUIElementPerformAction(element, kAXRaiseAction as CFString)
                    if let point = originalPointer, let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) {
                        move.setIntegerValueField(.eventSourceUserData, value: Self.eventMarker); move.post(tap: .cghidEventTap)
                    }
                }
            }
        }
        if activate {
        guard window.app.activate(options: []) else { throw HostFailure(code: "TARGET_NOT_READY", message: "The application could not become active.") }
        guard AXUIElementPerformAction(window.element, kAXRaiseAction as CFString) == .success else { throw HostFailure(code: "TARGET_NOT_READY", message: "The window could not become active.") }
        let activationDeadline = Date().addingTimeInterval(2)
        let activation = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { _ in CFRunLoopWakeUp(CFRunLoopGetMain()) }
        defer { NSWorkspace.shared.notificationCenter.removeObserver(activation) }
        while NSWorkspace.shared.frontmostApplication?.processIdentifier != window.app.processIdentifier && Date() < activationDeadline && !window.userInControl {
            try execution.check()
            CFRunLoopRunInMode(.defaultMode, activationDeadline.timeIntervalSinceNow, true)
        }
        }
        try execution.check()
        CFRunLoopRunInMode(.defaultMode, 0, true)
        guard (!window.userInControl || privateInput) else { throw HostFailure(code: "TAKEOVER_REQUIRED", message: "Automation is paused. Return control in Flower to continue.") }
        try execution.check()
        try prepare()
        for event in events {
            // Drain queued input notifications before every injection.
            CFRunLoopRunInMode(.defaultMode, 0, true)
            try execution.check()
            guard (!window.userInControl || privateInput) else { throw HostFailure(code: "TAKEOVER_REQUIRED", message: "Automation is paused. Return control in Flower to continue.") }
            try window.validate()
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == window.app.processIdentifier else {
                window.userInControl = true; window.invalidate()
                throw HostFailure(code: "TAKEOVER_REQUIRED", message: "The user changed the active application.")
            }
            guard let focused = axValue(window.application, kAXFocusedWindowAttribute), CFGetTypeID(focused) == AXUIElementGetTypeID(), CFEqual(focused, window.element) else {
                window.userInControl = true; window.invalidate()
                throw HostFailure(code: "TAKEOVER_REQUIRED", message: "Select the active application window before continuing.")
            }
            event.setIntegerValueField(.eventSourceUserData, value: Self.eventMarker)
            let before = delivered
            event.post(tap: .cghidEventTap)
            pending.posted(event)
            didPost()
            // Wait for the event tap receipt instead of flooding the HID queue.
            // Explicit cancellation is checked between delivery receipts.
            let deadline = Date().addingTimeInterval(1)
            while delivered == before && Date() < deadline && (!window.userInControl || privateInput) {
                try execution.check()
                CFRunLoopRunInMode(.defaultMode, deadline.timeIntervalSinceNow, true)
            }
            if delivered == before && !window.userInControl { throw HostFailure(code: "EFFECT_OUTCOME_UNKNOWN", message: "macOS did not confirm input delivery.") }
        }
        CFRunLoopRunInMode(.defaultMode, 0, true)
    }
}
