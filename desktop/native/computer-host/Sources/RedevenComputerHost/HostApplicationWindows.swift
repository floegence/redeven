import AppKit
import ApplicationServices

// Human sharing distinguishes an unreadable inventory from a confirmed empty
// inventory. Automation's best-effort discovery is not a lifecycle authority.
struct HostApplicationWindowPresence {
    private(set) var hadWindows = false
    private var emptySince: Date?
    mutating func observe(windowCount: Int?, at now: Date) -> Bool {
        guard let windowCount else { emptySince = nil; return false }
        if windowCount > 0 { hadWindows = true; emptySince = nil; return false }
        guard hadWindows else { return false }
        if let emptySince { return now.timeIntervalSince(emptySince) >= 1 }
        emptySince = now
        return false
    }
}

final class HostApplicationWindows {
    private var known: [CGWindowID: NativeWindow] = [:]
    struct Snapshot {
        let windows: [NativeWindow]
        // nil means the two native sources do not establish an empty inventory.
        let count: Int?
    }
    static func matchingWindowID(_ bounds: CGRect, candidates: [[String: Any]]) -> CGWindowID? {
        let matches = candidates.filter {
            guard let raw = $0[kCGWindowBounds as String] as? NSDictionary,
                  let frame = CGRect(dictionaryRepresentation: raw) else { return false }
            return abs(frame.minX - bounds.minX) < 1 && abs(frame.minY - bounds.minY) < 1 && abs(frame.width - bounds.width) < 1 && abs(frame.height - bounds.height) < 1
        }
        // WindowServer retains offscreen backing surfaces with identical bounds
        // (for example across fullscreen transitions). A unique visible surface
        // is authoritative; genuinely ambiguous visible windows stay unbound.
        let visible = matches.filter { ($0[kCGWindowIsOnscreen as String] as? Bool) == true }
        let eligible = visible.isEmpty ? matches : visible
        guard eligible.count == 1 else { return nil }
        return (eligible[0][kCGWindowNumber as String] as? NSNumber)?.uint32Value
    }
    func snapshot(_ app: NSRunningApplication) throws -> Snapshot {
        let application = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(application, 0.5)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(application, kAXWindowsAttribute as CFString, &value) == .success,
              let elements = value as? [AXUIElement],
              let list = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] else {
            throw HostFailure(code: "WINDOW_INVENTORY_UNAVAILABLE", message: "The application window list is temporarily unavailable.")
        }
        let candidates = list.filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == app.processIdentifier && ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0 }
        var current: [CGWindowID: NativeWindow] = [:]
        for element in elements.prefix(64) {
            if let bounds = axRect(element), !bounds.isEmpty,
               let id = Self.matchingWindowID(bounds, candidates: candidates) {
                if let old = known[id], CFEqual(old.element, element) {
                    current[id] = old
                } else {
                    current[id] = NativeWindow(app: app, application: application, element: element, windowID: id)
                }
            } else if let old = known.values.first(where: { CFEqual($0.element, element) }),
                      candidates.contains(where: { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == old.windowID }) {
                // Preserve a proven binding while resize/animation makes the
                // geometry transient. New bindings always require a unique match.
                current[old.windowID] = old
            }
        }
        known = current
        let focused = axValue(application, kAXFocusedWindowAttribute)
        let ordered = current.values.sorted { left, right in
            let a = focused.map { CFEqual($0, left.element) } ?? false
            let b = focused.map { CFEqual($0, right.element) } ?? false
            return a != b ? a : left.windowID < right.windowID
        }
        return Snapshot(windows: ordered, count: elements.isEmpty && !candidates.contains(where: { ($0[kCGWindowIsOnscreen as String] as? Bool) == true }) ? 0 : (ordered.isEmpty ? nil : ordered.count))
    }
}
