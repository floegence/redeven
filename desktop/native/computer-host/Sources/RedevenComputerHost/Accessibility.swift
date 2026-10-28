import AppKit
import ApplicationServices
import CryptoKit

func axValue(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
    return value
}

// Unsupported child attributes denote leaves; transport/read failures do not.
func axChildren(_ element: AXUIElement) throws -> [AXUIElement] {
    var value: CFTypeRef?
    let status = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value)
    if status == .attributeUnsupported || status == .noValue { return [] }
    guard status == .success, let children = value as? [AXUIElement] else {
        throw HostFailure(code: "TARGET_OBSERVATION_UNAVAILABLE", message: "The accessibility child list could not be read.")
    }
    return children
}

func axString(_ element: AXUIElement, _ attribute: String) -> String {
    (axValue(element, attribute) as? String) ?? ""
}

// Match Runtime's Unicode code-point budget, including combining characters.
func boundedAXText(_ text: String) -> String {
    String(String.UnicodeScalarView(text.unicodeScalars.prefix(2000)))
}

func axRect(_ element: AXUIElement) -> CGRect? {
    guard let position = axValue(element, kAXPositionAttribute), CFGetTypeID(position) == AXValueGetTypeID(),
          let size = axValue(element, kAXSizeAttribute), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, dimensions = CGSize.zero
    guard AXValueGetValue(unsafeBitCast(position, to: AXValue.self), .cgPoint, &point),
          AXValueGetValue(unsafeBitCast(size, to: AXValue.self), .cgSize, &dimensions) else { return nil }
    return CGRect(origin: point, size: dimensions)
}

func axNameIdentity(_ text: String) -> SHA256.Digest {
    SHA256.hash(data: Data(text.utf8))
}

func setAXText(_ field: String, _ full: String, in output: inout [String: Any]) {
    let text = boundedAXText(full)
    output[field] = text
    if text != full { output[field + "_truncated"] = true }
}

final class NativeWindow {
    struct Reference { let element: AXUIElement; let role: String; let nameIdentity: SHA256.Digest }
    let id: String
    private(set) var destructionObserved = false
    let app: NSRunningApplication
    let application: AXUIElement
    let element: AXUIElement
    let windowID: CGWindowID
    var observer: AXObserver?
    var revision = 0
    var references: [String: Reference] = [:]
    var userInControl = false
    var changed = false

    init(app: NSRunningApplication, application: AXUIElement, element: AXUIElement, windowID: CGWindowID, identity: String? = nil) {
        self.id = identity ?? "macos-window-" + UUID().uuidString.lowercased()
        self.app = app; self.application = application; self.element = element; self.windowID = windowID
        var observer: AXObserver?
        if AXObserverCreate(app.processIdentifier, { _, element, notification, pointer in
            guard let pointer else { return }
            let window = Unmanaged<NativeWindow>.fromOpaque(pointer).takeUnretainedValue()
            window.observeDestruction(element: element, notification: notification as String)
            window.changed = true
            if notification as String == kAXUIElementDestroyedNotification || notification as String == kAXWindowCreatedNotification {
                window.invalidate()
            }
            CFRunLoopWakeUp(CFRunLoopGetMain())
        }, &observer) == .success, let observer {
            self.observer = observer
            for notification in [kAXUIElementDestroyedNotification, kAXWindowCreatedNotification, kAXValueChangedNotification,
                                 kAXTitleChangedNotification, kAXFocusedUIElementChangedNotification,
                                 kAXSelectedChildrenChangedNotification, kAXLayoutChangedNotification] {
                AXObserverAddNotification(observer, application, notification as CFString, Unmanaged.passUnretained(self).toOpaque())
                AXObserverAddNotification(observer, element, notification as CFString, Unmanaged.passUnretained(self).toOpaque())
            }
            CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
        }
    }

    func observeDestruction(element: AXUIElement, notification: String) {
        if notification == kAXUIElementDestroyedNotification && CFEqual(element, self.element) { destructionObserved = true }
    }

    deinit { if let observer { CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes) } }
    func clearReferences() {
        if let observer {
            for reference in references.values where !CFEqual(reference.element, element) && !CFEqual(reference.element, application) {
                for notification in [kAXUIElementDestroyedNotification, kAXValueChangedNotification, kAXTitleChangedNotification] {
                    AXObserverRemoveNotification(observer, reference.element, notification as CFString)
                }
            }
        }
        references.removeAll()
    }
    func invalidate() { revision += 1; clearReferences(); changed = true }

    func validate() throws {
        guard !app.isTerminated,
              let windows = axValue(application, kAXWindowsAttribute) as? [AXUIElement],
              windows.contains(where: { CFEqual($0, element) }),
              let list = CGWindowListCopyWindowInfo(.optionIncludingWindow, windowID) as? [[String: Any]],
              list.contains(where: { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == windowID && ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == app.processIdentifier }) else {
            invalidate()
            throw HostFailure(code: "TARGET_CONNECTION_REQUIRED", message: "Select an available application window.")
        }
    }

    func contains(_ node: AXUIElement) -> Bool {
        var current: AXUIElement? = node
        for _ in 0..<80 {
            guard let element = current else { return false }
            if CFEqual(element, self.element) { return true }
            guard let parent = axValue(element, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID() else { return false }
            current = unsafeBitCast(parent, to: AXUIElement.self)
        }
        return false
    }

    func safety(allowedApps: [String], fullAccess: Bool = false, privateInput: Bool = false, check: () throws -> Void = {}) throws -> [String: Any] {
        try check()
        try validate()
        var reasons: Set<String> = []
        if !privateInput {
            if userInControl { reasons.insert("user_control") }
            if !fullAccess && !allowedApps.contains(app.bundleIdentifier ?? "") { reasons.insert("app_permission") }
            // Inspect roles before reading any values. Secure fields never
            // contribute their labels, values or pixels to model observations.
            var queue = [element], visited = 0
            while !queue.isEmpty && visited < 5000 {
                try check()
                let node = queue.removeLast()
                visited += 1
                if axString(node, kAXSubroleAttribute) == kAXSecureTextFieldSubrole { reasons.insert("secret_input") }
                if let children = axValue(node, kAXChildrenAttribute) as? [AXUIElement] { queue.append(contentsOf: children.prefix(5001)) }
                if queue.count > 10000 { break }
            }
            try validateNativeSafetyScan(remainingNodes: queue.count, confirmedReasons: reasons)
        }
        var result: [String: Any] = ["level": reasons.isEmpty ? "routine" : "takeover", "reason_codes": reasons.sorted(),
                                     "safe_to_capture": reasons.isEmpty, "safe_to_send_to_model": reasons.isEmpty]
        if reasons.contains("app_permission") { result["required_app"] = app.bundleIdentifier ?? "" }
        return result
    }

    func name(_ node: AXUIElement) -> String {
        for attribute in [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute] {
            let text = axString(node, attribute)
            if !text.isEmpty { return text }
        }
        return ""
    }

    func describe(_ node: AXUIElement) -> [String: Any] {
        let role = axString(node, kAXRoleAttribute)
        let fullName = name(node)
        let identity = axNameIdentity(fullName)
        let ref: String
        if let existing = references.first(where: { CFEqual($0.value.element, node) && $0.value.role == role && $0.value.nameIdentity == identity }) { ref = existing.key }
        else {
            if references.count >= 2000 { clearReferences() }
            ref = "\(id):\(revision):\(UUID().uuidString)"; references[ref] = Reference(element: node, role: role, nameIdentity: identity)
            if let observer, !CFEqual(node, element), !CFEqual(node, application) {
                for notification in [kAXUIElementDestroyedNotification, kAXValueChangedNotification, kAXTitleChangedNotification] {
                    AXObserverAddNotification(observer, node, notification as CFString, Unmanaged.passUnretained(self).toOpaque())
                }
            }
        }
        var actions: CFArray?
        AXUIElementCopyActionNames(node, &actions)
        let supported = (actions as? [String]) ?? []
        var writable = DarwinBoolean(false)
        AXUIElementIsAttributeSettable(node, kAXValueAttribute as CFString, &writable)
        var operations = ["read"]
        if supported.contains(kAXPressAction) { operations.append("click") }
        if writable.boolValue { operations.append("fill") }
        var states: [String: Any] = [:]
        for (key, attribute) in [("enabled", kAXEnabledAttribute), ("focused", kAXFocusedAttribute), ("selected", kAXSelectedAttribute), ("expanded", kAXExpandedAttribute), ("required", "AXRequired"), ("invalid", "AXInvalid"), ("busy", "AXElementBusy")] {
            if let value = axValue(node, attribute) as? NSNumber { states[key] = value.boolValue }
        }
        if let enabled = states["enabled"] as? Bool { states["disabled"] = !enabled }
        if [kAXCheckBoxRole, kAXRadioButtonRole].contains(role), let value = axValue(node, kAXValueAttribute) as? NSNumber {
            states["checked"] = value.intValue == 2 ? "mixed" : value.boolValue as Any
        }
        if [kAXTextFieldRole, kAXTextAreaRole].contains(role) {
            var settable = DarwinBoolean(false)
            if AXUIElementIsAttributeSettable(node, kAXValueAttribute as CFString, &settable) == .success { states["readonly"] = !settable.boolValue }
        }
        var output: [String: Any] = ["ref": ref, "child_refs": [String](), "role": role, "platform_role": role, "states": states, "actions": operations, "platform_actions": supported]
        setAXText("name", fullName, in: &output)
        let subrole = axString(node, kAXSubroleAttribute)
        if !subrole.isEmpty { output["platform_subrole"] = subrole }
        let help = axString(node, kAXHelpAttribute)
        let description = help.isEmpty ? axString(node, kAXDescriptionAttribute) : help
        if !description.isEmpty && description != fullName { setAXText("description", description, in: &output) }
        if subrole != kAXSecureTextFieldSubrole {
            if let value = axValue(node, kAXValueAttribute) as? String { setAXText("value", value, in: &output) }
            else if let value = axValue(node, kAXValueAttribute) as? NSNumber { output["value"] = value }
        }
        if let bounds = axRect(node), let window = axRect(element) {
            output["bounds"] = ["x": bounds.minX - window.minX, "y": bounds.minY - window.minY, "width": bounds.width, "height": bounds.height]
        }
        return output
    }

    func observe(_ args: [String: Any], check: () throws -> Void = {}) throws -> [String: Any] {
        try check()
        let limit = args["limit"] as? Int ?? 200
        guard limit > 0 && limit <= 1000 else { throw NativeInput.invalid("Observation limit must be between 1 and 1000.") }
        let root = try (args["root_ref"] as? String).map { try resolve(["ref": $0]) } ?? element
        var queue: [(AXUIElement, String?)] = [(root, nil)], nodes: [[String: Any]] = [], elements: [AXUIElement] = [], visited: [AXUIElement] = []
        var indices: [String: Int] = [:]
        var childrenOmitted = false
        while !queue.isEmpty && nodes.count < limit && visited.count < 5000 {
            try check()
            let (node, parentRef) = queue.removeFirst()
            if visited.contains(where: { CFEqual($0, node) }) { continue }
            visited.append(node)
            var childParent = parentRef
            if !axString(node, kAXRoleAttribute).isEmpty {
                var output = describe(node)
                let ref = output["ref"] as! String
                if let parentRef, let index = indices[parentRef] {
                    output["parent_ref"] = parentRef
                    var children = nodes[index]["child_refs"] as! [String]
                    children.append(ref); nodes[index]["child_refs"] = children
                }
                indices[ref] = nodes.count
                nodes.append(output); elements.append(node); childParent = ref
            }
            let children = try axChildren(node)
            if children.count > 1001 {
                childrenOmitted = true
                if let childParent, let index = indices[childParent] { nodes[index]["children_truncated"] = true }
            }
            queue.append(contentsOf: children.prefix(1001).map { ($0, childParent) })
        }
        for (node, parentRef) in queue where !visited.contains(where: { CFEqual($0, node) }) {
            if let parentRef, let index = indices[parentRef] { nodes[index]["children_truncated"] = true }
        }
        for (index, node) in elements.enumerated() {
            try check()
            if let title = axValue(node, kAXTitleUIElementAttribute), CFGetTypeID(title) == AXUIElementGetTypeID(),
               let related = elements.firstIndex(where: { CFEqual($0, title) }) {
                nodes[index]["relations"] = ["labelled_by": [nodes[related]["ref"] as! String]]
            }
        }
        return ["source": "macos_accessibility", "coverage": "application_provided", "semantic_schema_version": 2, "document_id": "\(id):\(revision)", "nodes": nodes, "truncated": childrenOmitted || !queue.isEmpty, "execution_mode": "background"]
    }

    func resolve(_ selector: [String: Any]) throws -> AXUIElement {
        try validate()
        if let ref = selector["ref"] as? String {
            guard let reference = references[ref], contains(reference.element), reference.role == axString(reference.element, kAXRoleAttribute), reference.nameIdentity == axNameIdentity(name(reference.element)) else { throw HostFailure(code: "STALE_REFERENCE", message: "Observe the window again.") }
            return reference.element
        }
        let roles = (selector["roles"] as? [String]) ?? (selector["role"] as? String).map { [$0] } ?? []
        guard !roles.isEmpty else { throw NativeInput.invalid("A role or reference is required.") }
        let wantedName = selector["name"] as? String
        let exact = selector["exact"] as? Bool ?? false
        let root = try (selector["root_ref"] as? String).map { try resolve(["ref": $0]) } ?? element
        var queue = [root], matches: [AXUIElement] = [], visited = 0
        while !queue.isEmpty && visited < 5000 {
                let node = queue.removeLast()
            visited += 1
            let candidateName = self.name(node)
            let nameMatches = wantedName == nil || (exact ? candidateName == wantedName! : candidateName.localizedCaseInsensitiveContains(wantedName!))
            if roles.contains(axString(node, kAXRoleAttribute)) && nameMatches { matches.append(node) }
            if matches.count > 1 { break }
            if let children = axValue(node, kAXChildrenAttribute) as? [AXUIElement] { queue.append(contentsOf: children.prefix(5001)) }
            if queue.count > 10000 { break }
        }
        guard matches.count == 1 && queue.isEmpty else {
            throw HostFailure(code: matches.isEmpty && queue.isEmpty ? "ELEMENT_NOT_FOUND" : "AMBIGUOUS_ELEMENT", message: "Observe a smaller subtree and use its reference.")
        }
        return matches[0]
    }

    func action(_ args: [String: Any], willMutate: () throws -> Void = {}) throws -> [String: Any] {
        guard !userInControl else { throw HostFailure(code: "TAKEOVER_REQUIRED", message: "Return control before continuing.") }
        let selector = args["selector"] as? [String: Any] ?? [:]
        let action = args["action"] as? String ?? ""
        if action == "wait" { return try wait(selector, args) }
        let node = try resolve(selector)
        switch action {
        case "read":
            let snapshot = try observe(["root_ref": describe(node)["ref"]!, "limit": 1])
            guard let nodes = snapshot["nodes"] as? [[String: Any]], let first = nodes.first else {
                throw HostFailure(code: "TARGET_OBSERVATION_UNAVAILABLE", message: "The selected node could not be read.")
            }
            return ["semantic_schema_version": 2, "node": first]
        case "click":
            var actions: CFArray?
            AXUIElementCopyActionNames(node, &actions)
            guard (actions as? [String])?.contains(kAXPressAction) == true else { throw HostFailure(code: "TARGET_CAPABILITY_UNAVAILABLE", message: "This control does not support AXPress; use a foreground action.") }
            try execution.check(); try willMutate()
            let result = AXUIElementPerformAction(node, kAXPressAction as CFString)
            guard result == .success else { throw HostFailure(code: "EFFECT_OUTCOME_UNKNOWN", message: "The application did not confirm the action.") }
        case "fill":
            guard let text = args["text"] as? String, text.count <= 20000 else { throw NativeInput.invalid("A bounded text value is required.") }
            var writable = DarwinBoolean(false)
            AXUIElementIsAttributeSettable(node, kAXValueAttribute as CFString, &writable)
            guard writable.boolValue else { throw HostFailure(code: "TARGET_CAPABILITY_UNAVAILABLE", message: "This control does not accept a semantic value.") }
            try execution.check(); try willMutate()
            let result = AXUIElementSetAttributeValue(node, kAXValueAttribute as CFString, text as CFString)
            guard result == .success else { throw HostFailure(code: "EFFECT_OUTCOME_UNKNOWN", message: "The application did not confirm the value.") }
        default: throw HostFailure(code: "TARGET_CAPABILITY_UNAVAILABLE", message: "This action requires foreground input.")
        }
        return ["action_executed": true, "execution_mode": "background"]
    }

    func wait(_ selector: [String: Any], _ args: [String: Any]) throws -> [String: Any] {
        let state = args["state"] as? String ?? "visible", timeout = args["timeout_ms"] as? Int ?? 10000
        guard ["visible", "hidden", "enabled"].contains(state), timeout >= 0 && timeout <= 30000 else { throw NativeInput.invalid("Invalid wait condition.") }
        guard observer != nil else { throw HostFailure(code: "TARGET_CAPABILITY_UNAVAILABLE", message: "The application does not provide AX notifications.") }
        let deadline = Date().addingTimeInterval(Double(timeout) / 1000)
        while true {
            try execution.check()
            guard !userInControl else { throw HostFailure(code: "TAKEOVER_REQUIRED", message: "User input paused automation.") }
            changed = false
            var found = false, enabled = false
            do { let node = try resolve(selector); found = true; enabled = (axValue(node, kAXEnabledAttribute) as? NSNumber)?.boolValue == true }
            catch let error as HostFailure where error.code == "ELEMENT_NOT_FOUND" { }
            if (state == "hidden" && !found) || (state == "visible" && found) || (state == "enabled" && enabled) { return ["state": state] }
            guard Date() < deadline else { return ["state": "timeout", "requested_state": state, "last_known": ["found": found, "enabled": enabled]] }
            if !changed { CFRunLoopRunInMode(.defaultMode, deadline.timeIntervalSinceNow, true) }
        }
    }
}

final class NativeAccessibility {
    var windows: [String: NativeWindow] = [:]

    func applications(query: String) throws -> [[String: Any]] {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, query.count <= 120 else { throw NativeInput.invalid("An application name or bundle ID is required.") }
        let running = NSWorkspace.shared.runningApplications
        return HostApplicationCatalog.applications().compactMap { url -> [String: Any]? in
            guard let bundle = Bundle(url: url), let id = bundle.bundleIdentifier else { return nil }
            let name = (bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String) ?? (bundle.object(forInfoDictionaryKey: "CFBundleName") as? String) ?? url.deletingPathExtension().lastPathComponent
            guard name.localizedCaseInsensitiveContains(query) || id.localizedCaseInsensitiveContains(query) else { return nil }
            let app = running.first { $0.bundleURL?.resolvingSymlinksInPath() == url }
            return ["id": HostApplicationCatalog.identifier(url), "display_name": name, "app_bundle_id": id, "state": app == nil ? "not_running" : "running"]
        }.prefix(64).map { $0 }
    }

    func openApplication(id: String, bundleID: String, fullAccess: Bool, allowedApps: [String], allowForeground: Bool, started: () -> Void) throws -> [[String: Any]] {
        guard HostApplicationCatalog.consoleAvailable, AXIsProcessTrusted(), CGPreflightScreenCaptureAccess() else { throw HostFailure(code: "TARGET_PERMISSION_REQUIRED", message: "Allow screen recording and accessibility in an unlocked desktop session.") }
        guard fullAccess || (allowedApps.contains(bundleID) && allowForeground) else { throw HostFailure(code: "TARGET_PERMISSION_REQUIRED", message: "Application and foreground permission are required.") }
        guard let url = HostApplicationCatalog.applications().first(where: { HostApplicationCatalog.identifier($0) == id }), Bundle(url: url)?.bundleIdentifier == bundleID else { throw HostFailure(code: "TARGET_CONNECTION_REQUIRED", message: "Discover the application again.") }
        try execution.check()
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.createsNewApplicationInstance = false
        var completed = false
        var opened: NSRunningApplication?
        let completionLock = NSLock()
        func result() -> (Bool, NSRunningApplication?) {
            completionLock.lock(); defer { completionLock.unlock() }
            return (completed, opened)
        }
        started()
        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { application, _ in
            completionLock.lock(); opened = application; completed = true; completionLock.unlock()
            CFRunLoopWakeUp(CFRunLoopGetMain())
        }
        let deadline = Date().addingTimeInterval(8)
        while !result().0 && Date() < deadline { try execution.check(); CFRunLoopRunInMode(.defaultMode, 0.05, true) }
        guard result().0, let opened = result().1, opened.bundleURL?.resolvingSymlinksInPath() == url else { throw HostFailure(code: "TARGET_ACTION_FAILED", message: "Application launch was not confirmed; inspect before retrying.") }
        let application = AXUIElementCreateApplication(opened.processIdentifier)
        let ready = Date().addingTimeInterval(2)
        var restored: [AXUIElement] = []
        var previous = ""
        var stableSince = Date()
        repeat {
            try execution.check()
            var settling = false
            for window in (axValue(application, kAXWindowsAttribute) as? [AXUIElement] ?? []) where (axValue(window, kAXMinimizedAttribute) as? Bool) == true {
                settling = true
                if !restored.contains(where: { CFEqual($0, window) }) {
                    try execution.check()
                    guard AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse) == .success else { throw NativeInput.unavailable() }
                    restored.append(window)
                }
            }
            let targets = try inventory(onlyOwner: opened.processIdentifier)
            let signature = targets.compactMap { $0["id"] as? String }.sorted().joined(separator: ",")
            if settling || signature != previous { previous = signature; stableSince = Date() }
            if !settling && !targets.isEmpty && Date().timeIntervalSince(stableSince) >= 0.2 { return targets }
            CFRunLoopRunInMode(.defaultMode, 0.05, true)
        } while Date() < ready
        return []
    }

    func inventory(onlyOwner: pid_t? = nil) throws -> [[String: Any]] {
        guard AXIsProcessTrusted() else { throw HostFailure(code: "TARGET_PERMISSION_REQUIRED", message: "Allow Accessibility in System Settings.") }
        let excluded = try NativeScreenCapture.excludedOwner(environment: ProcessInfo.processInfo.environment)
        guard let cgWindows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] else { throw NativeInput.unavailable() }
        windows = windows.filter { (try? $0.value.validate()) != nil }
        var result: [[String: Any]] = []
        for app in NSWorkspace.shared.runningApplications where app.activationPolicy != .prohibited && app.processIdentifier != excluded && (onlyOwner == nil || app.processIdentifier == onlyOwner) {
            guard let bundle = app.bundleIdentifier else { continue }
            let application = AXUIElementCreateApplication(app.processIdentifier)
            AXUIElementSetMessagingTimeout(application, 0.5)
            guard let items = axValue(application, kAXWindowsAttribute) as? [AXUIElement] else { continue }
            for element in items.prefix(64) {
                guard let bounds = axRect(element), !bounds.isEmpty else { continue }
                let candidates = cgWindows.filter { item in
                    guard (item[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == app.processIdentifier,
                          (item[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
                          let raw = item[kCGWindowBounds as String] as? NSDictionary,
                          let rect = CGRect(dictionaryRepresentation: raw) else { return false }
                    return abs(rect.minX - bounds.minX) < 1 && abs(rect.minY - bounds.minY) < 1 && abs(rect.width - bounds.width) < 1 && abs(rect.height - bounds.height) < 1
                }
                // Public AX has no window-number contract. Bind only an exact,
                // unique geometry match and retain the actual AX window object.
                guard candidates.count == 1, let number = candidates[0][kCGWindowNumber as String] as? NSNumber else { continue }
                let window = windows.values.first(where: { CFEqual($0.element, element) && $0.app.processIdentifier == app.processIdentifier }) ?? NativeWindow(app: app, application: application, element: element, windowID: number.uint32Value)
                windows[window.id] = window
                result.append(["id": window.id, "kind": "desktop.window", "display_name": "\(app.localizedName ?? bundle) — \(axString(element, kAXTitleAttribute))", "app_bundle_id": bundle,
                               "locality": "local", "capabilities": ["observe", "interaction"], "state": "ready", "ready": true, "permission_state": "granted"])
                if result.count >= 128 { return result }
            }
        }
        return result
    }
}

// Incomplete scans cannot prove safety or a human requirement. Confirmed private
// content still blocks capture even when the rest of the tree is unavailable.
func validateNativeSafetyScan(remainingNodes: Int, confirmedReasons: Set<String>) throws {
    if remainingNodes > 0 && confirmedReasons.isEmpty {
        throw HostFailure(code: "TARGET_OBSERVATION_UNAVAILABLE", message: "The accessibility safety scan exceeded its limit.")
    }
}
