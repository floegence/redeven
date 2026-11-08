import AppKit

enum HostApplicationPermissions {
    static func perform(_ permission: String,
                        screen: () -> Bool = { CGRequestScreenCaptureAccess() },
                        input: () -> Bool = { AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) },
                        open: (URL) -> Bool = { NSWorkspace.shared.open($0) }) throws {
        let pane: String
        switch permission {
        case "screen_recording":
            if screen() { return }
            pane = "Privacy_ScreenCapture"
        case "accessibility":
            if input() { return }
            pane = "Privacy_Accessibility"
        case "screen_recording_settings": pane = "Privacy_ScreenCapture"
        case "accessibility_settings": pane = "Privacy_Accessibility"
        default: throw NativeInput.invalid("Unknown permission.")
        }
        guard open(URL(string: "x-apple.systempreferences:com.apple.preference.security?" + pane)!) else {
            throw NativeInput.invalid("System Settings could not be opened.")
        }
    }
}
