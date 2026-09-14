import CoreGraphics
import Foundation
import ScreenCaptureKit

// All capture paths apply the same Desktop-owner exclusion. A failed filtered
// capture must never fall back to an unrestricted screenshot.
enum NativeScreenCapture {
    static func excludedOwner(environment: [String: String]) throws -> pid_t? {
        guard let raw = environment["REDEVEN_COMPUTER_EXCLUDED_WINDOW_OWNER_PID"] else { return nil }
        guard let pid = Int32(raw), pid > 0 else {
            throw HostFailure(code: "FRAME_UNAVAILABLE", message: "The excluded window owner is invalid.")
        }
        return pid
    }

    static func capture(displayID: CGDirectDisplayID, excludedOwner: pid_t?) throws -> CGImage {
        if #available(macOS 14.0, *) {
            return try captureFiltered(displayID: displayID, excludedOwner: excludedOwner)
        }
        // macOS 13 does not provide SCScreenshotManager.
        let bounds = CGDisplayBounds(displayID)
        let image: CGImage?
        if let excludedOwner {
            guard let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] else {
                throw HostFailure(code: "FRAME_UNAVAILABLE", message: "macOS could not enumerate visible windows.")
            }
            let included = windows.compactMap { window -> NSNumber? in
                guard (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value != excludedOwner else { return nil }
                return window[kCGWindowNumber as String] as? NSNumber
            }
            image = CGImage(windowListFromArrayScreenBounds: bounds, windowArray: included as CFArray, imageOption: .bestResolution)
        } else {
            image = CGDisplayCreateImage(displayID)
        }
        guard let image else { throw unavailable() }
        return image
    }

    private static func unavailable() -> HostFailure {
        HostFailure(code: "FRAME_UNAVAILABLE", message: "macOS could not capture the allowed screen content.")
    }

    @available(macOS 14.0, *)
    private static func captureFiltered(displayID: CGDirectDisplayID, excludedOwner: pid_t?) throws -> CGImage {
        let completion = DispatchSemaphore(value: 0)
        let result = CaptureResult()
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, _ in
            guard let content, let display = content.displays.first(where: { $0.displayID == displayID }) else {
                completion.signal()
                return
            }
            let excludedApplications = content.applications.filter { $0.processID == excludedOwner }
            let filter = SCContentFilter(display: display, excludingApplications: excludedApplications, exceptingWindows: [])
            let configuration = SCStreamConfiguration()
            let bounds = CGDisplayBounds(displayID)
            configuration.width = Int(bounds.width)
            configuration.height = Int(bounds.height)
            configuration.showsCursor = true
            SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) { image, _ in
                result.set(image)
                completion.signal()
            }
        }
        guard completion.wait(timeout: .now() + 5) == .success, let image = result.get() else {
            throw unavailable()
        }
        return image
    }
}

private final class CaptureResult: @unchecked Sendable {
    private let lock = NSLock()
    private var image: CGImage?
    func set(_ image: CGImage?) { lock.lock(); defer { lock.unlock() }; self.image = image }
    func get() -> CGImage? { lock.lock(); defer { lock.unlock() }; return image }
}
