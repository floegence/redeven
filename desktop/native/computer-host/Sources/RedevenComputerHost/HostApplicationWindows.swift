import AppKit
import ApplicationServices

// The registry proves window lifetime independently of capture availability.
// Only a confirmed empty inventory can start the window replacement grace.
enum HostApplicationWindowState: String {
    case present, unknown, confirmedEmpty
}
struct HostApplicationWindowPresence {
    private(set) var hadWindows = false
    private var emptySince: TimeInterval?
    mutating func observe(_ state: HostApplicationWindowState, at now: TimeInterval) -> Bool {
        switch state {
        case .present: hadWindows = true; emptySince = nil
        case .unknown: emptySince = nil
        case .confirmedEmpty:
            guard hadWindows else { return false }
            if let emptySince { return now - emptySince >= 1 }
            emptySince = now
        }
        return false
    }
}

final class HostApplicationWindows {
    private var known: [NativeWindow] = []
    private var retiredSurfaces = Set<CGWindowID>()
    private var destroyedElements: [AXUIElement] = []
    struct Snapshot {
        let windows: [NativeWindow]
        let focusedID: String?
        let state: HostApplicationWindowState
        let retainedCount: Int
    }
    // A missing AX listing is not destruction. An exact destruction notification
    // retires even a cached WindowServer surface; other AX failures remain unknown.
    static func retainedState(destructionObserved: Bool, axStatus: AXError, surfaceExists: Bool) -> HostApplicationWindowState {
        if destructionObserved || (axStatus == .invalidUIElement && !surfaceExists) { return .confirmedEmpty }
        if surfaceExists || axStatus == .success { return .present }
        return .unknown
    }
    func reset() {
        known.removeAll(); retiredSurfaces.removeAll(); destroyedElements.removeAll()
    }
    func restore(_ id: String?) {
        guard let window = known.first(where: { $0.id == id && !$0.destructionObserved }) else { return }
        // This is an explicit reconnect action, never background inventory work.
        AXUIElementSetAttributeValue(window.element, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
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
        let candidates = list.filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == app.processIdentifier }
        return reconcile(app, application: application, elements: elements, candidates: candidates,
            focused: axValue(application, kAXFocusedWindowAttribute), bounds: axRect,
            passive: { element, bounds in
                !app.isHidden && (axValue(element, kAXMinimizedAttribute) as? Bool) != true && self.isPassiveSurface(element, bounds: bounds)
            }, roleStatus: { element in
                var role: CFTypeRef?
                return AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
            })
    }
    // Native reads end here. Reconciliation is deterministic even when AX omits
    // windows or WindowServer temporarily retains a destroyed capture surface.
    func reconcile(_ app: NSRunningApplication, application: AXUIElement, elements: [AXUIElement],
                   candidates: [[String: Any]], focused: CFTypeRef?,
                   bounds: (AXUIElement) -> CGRect?, passive: (AXUIElement, CGRect) -> Bool,
                   roleStatus: (AXUIElement) -> AXError) -> Snapshot {
        let surfaceIDs = Set(candidates.compactMap { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value })
        var next: [NativeWindow] = [], available: [NativeWindow] = []
        var passiveIDs = Set<CGWindowID>()
        retiredSurfaces.formIntersection(surfaceIDs)
        destroyedElements.removeAll { destroyed in !elements.contains { CFEqual($0, destroyed) } }
        for window in known where window.destructionObserved {
            retiredSurfaces.insert(window.windowID)
            if elements.contains(where: { CFEqual($0, window.element) }) { destroyedElements.append(window.element) }
        }
        var uncertain = elements.count > 64
        var present = false
        for element in elements.prefix(64) {
            guard !destroyedElements.contains(where: { CFEqual($0, element) }) else { continue }
            let old = known.first { !$0.destructionObserved && CFEqual($0.element, element) }
            let bounds = bounds(element)
            let matched = bounds.flatMap { $0.isEmpty ? nil : Self.matchingWindowID($0, candidates: candidates) }
            if old == nil, let bounds, let id = matched, passive(element, bounds) {
                passiveIDs.insert(id)
                continue
            }
            // Retain an established binding through resize/animation. A source
            // replacement preserves the AX identity but gets a new capture binding.
            let id = matched ?? old.flatMap { surfaceIDs.contains($0.windowID) ? $0.windowID : nil } ?? kCGNullWindowID
            let window: NativeWindow
            if let old, old.windowID == id { window = old }
            else { window = NativeWindow(app: app, application: application, element: element, windowID: id, identity: old?.id) }
            if let old, old.windowID != id { retiredSurfaces.insert(old.windowID) }
            retiredSurfaces.remove(id)
            next.append(window)
            present = true
            if id != kCGNullWindowID { available.append(window) }
        }
        for window in known where !next.contains(where: { CFEqual($0.element, window.element) }) {
            if passiveIDs.contains(window.windowID) { continue }
            let status = window.destructionObserved ? AXError.invalidUIElement : roleStatus(window.element)
            let state = Self.retainedState(destructionObserved: window.destructionObserved,
                axStatus: status, surfaceExists: window.windowID != kCGNullWindowID && surfaceIDs.contains(window.windowID) &&
                    !next.contains(where: { $0.windowID == window.windowID && !CFEqual($0.element, window.element) }))
            if state == .confirmedEmpty { retiredSurfaces.insert(window.windowID); continue }
            next.append(window)
            present = present || state == .present
            uncertain = uncertain || state == .unknown
        }
        known = next
        let accounted = Set(next.map(\.windowID)).union(passiveIDs).union(retiredSurfaces)
        // An unbound visible normal window may be a newly created replacement.
        // Offscreen evidence comes from registered identities, not arbitrary
        // cached surfaces that WindowServer can retain after real destruction.
        uncertain = uncertain || candidates.contains {
            guard let id = ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value else { return false }
            return !accounted.contains(id) && ($0[kCGWindowIsOnscreen as String] as? Bool) == true &&
                ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0
        }
        let ordered = available.sorted { left, right in
            let a = focused.map { CFEqual($0, left.element) } ?? false
            let b = focused.map { CFEqual($0, right.element) } ?? false
            return a != b ? a : left.windowID < right.windowID
        }
        let focusedID = ordered.first.flatMap { window in
            focused.map { CFEqual($0, window.element) } == true ? window.id : nil
        }
        return Snapshot(windows: ordered, focusedID: focusedID,
            state: present ? .present : uncertain ? .unknown : .confirmedEmpty, retainedCount: known.count)
    }
}
