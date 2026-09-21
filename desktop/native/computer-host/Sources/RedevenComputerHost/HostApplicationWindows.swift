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
    private var observedWindowIDs = Set<CGWindowID>()
    struct Snapshot {
        let windows: [NativeWindow]
        let focusedID: String?
        // nil means the two native sources do not establish an empty inventory.
        let count: Int?
    }
    static func isPassiveSurface(bounds: CGRect, activationPoint: CGPoint?, mainSettable: Bool?, focused: Bool?, modal: Bool?, hasControls: Bool) -> Bool {
        // AppKit can include capture indicators in AXWindows. They have no
        // independent activation target. Missing metadata is not exclusion proof.
        guard let activationPoint, mainSettable == false, focused == false,
              modal == false, !hasControls else { return false }
        return !bounds.contains(activationPoint)
    }
    private func isPassiveSurface(_ element: AXUIElement, bounds: CGRect) -> Bool {
        guard let value = axValue(element, NSAccessibility.Attribute.activationPoint.rawValue), CFGetTypeID(value) == AXValueGetTypeID() else { return false }
        var point = CGPoint.zero
        guard AXValueGetValue(unsafeBitCast(value, to: AXValue.self), .cgPoint, &point), !bounds.contains(point) else { return false }
        var mainSettable = DarwinBoolean(false)
        let mainResult = AXUIElementIsAttributeSettable(element, kAXMainAttribute as CFString, &mainSettable)
        let controls = [kAXCloseButtonAttribute, kAXTitleUIElementAttribute, kAXDefaultButtonAttribute, kAXCancelButtonAttribute]
        return Self.isPassiveSurface(bounds: bounds, activationPoint: point,
            mainSettable: mainResult == .success ? mainSettable.boolValue : nil,
            focused: axValue(element, kAXFocusedAttribute) as? Bool,
            modal: axValue(element, kAXModalAttribute) as? Bool,
            hasControls: controls.contains { axValue(element, $0) != nil })
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
        // AXWindows also contains real floating panels. WindowServer layer zero
        // alone is not the application's interactive window inventory.
        let candidates = list.filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == app.processIdentifier }
        var current: [CGWindowID: NativeWindow] = [:]
        var passiveIDs = Set<CGWindowID>()
        var applicationElementCount = elements.count
        for element in elements.prefix(64) {
            if let bounds = axRect(element), !bounds.isEmpty,
               let id = Self.matchingWindowID(bounds, candidates: candidates) {
                if !app.isHidden, (axValue(element, kAXMinimizedAttribute) as? Bool) != true,
                   isPassiveSurface(element, bounds: bounds) {
                    passiveIDs.insert(id); applicationElementCount -= 1; continue
                }
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
        observedWindowIDs.formIntersection(candidates.compactMap { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value })
        observedWindowIDs.formUnion(current.keys)
        observedWindowIDs.subtract(passiveIDs)
        known = current
        let focused = axValue(application, kAXFocusedWindowAttribute)
        let ordered = current.values.sorted { left, right in
            let a = focused.map { CFEqual($0, left.element) } ?? false
            let b = focused.map { CFEqual($0, right.element) } ?? false
            return a != b ? a : left.windowID < right.windowID
        }
        let focusedID = ordered.first.flatMap { window in
            focused.map { CFEqual($0, window.element) } == true ? window.id : nil
        }
        let visiblyEmpty = !candidates.contains {
            let id = ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value ?? 0
            // A known floating window remains lifecycle evidence if an AX read
            // temporarily omits it. Unrelated menu/status-bar surfaces do not.
            return ($0[kCGWindowIsOnscreen as String] as? Bool) == true && !passiveIDs.contains(id) &&
                (($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0 || observedWindowIDs.contains(id))
        }
        let count = applicationElementCount == 0 && visiblyEmpty ? 0 : (ordered.isEmpty ? nil : ordered.count)
        return Snapshot(windows: ordered, focusedID: focusedID, count: count)
    }
}
