import AppKit
import ApplicationServices

func axValue(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
    return value
}

func axString(_ element: AXUIElement, _ attribute: String) -> String {
    (axValue(element, attribute) as? String) ?? ""
}

func axRect(_ element: AXUIElement) -> CGRect? {
    guard let position = axValue(element, kAXPositionAttribute), CFGetTypeID(position) == AXValueGetTypeID(),
          let size = axValue(element, kAXSizeAttribute), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, dimensions = CGSize.zero
    guard AXValueGetValue(unsafeBitCast(position, to: AXValue.self), .cgPoint, &point),
          AXValueGetValue(unsafeBitCast(size, to: AXValue.self), .cgSize, &dimensions) else { return nil }
    return CGRect(origin: point, size: dimensions)
}

final class NativeWindow {
    struct Reference { let element: AXUIElement; let role: String; let name: String }
    let id = "macos-window-" + UUID().uuidString.lowercased()
    let app: NSRunningApplication
    let application: AXUIElement
    let element: AXUIElement
    let windowID: CGWindowID
    var observer: AXObserver?
    var revision = 0
    var references: [String: Reference] = [:]
    var userInControl = false
    var changed = false

    init(app: NSRunningApplication, application: AXUIElement, element: AXUIElement, windowID: CGWindowID) {
        self.app = app; self.application = application; self.element = element; self.windowID = windowID
        var observer: AXObserver?
        if AXObserverCreate(app.processIdentifier, { _, element, notification, pointer in
            guard let pointer else { return }
            let window = Unmanaged<NativeWindow>.fromOpaque(pointer).takeUnretainedValue()
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

    func safety(allowedApps: [String], fullAccess: Bool = false, privateInput: Bool = false) throws -> [String: Any] {
        try validate()
        var reasons: Set<String> = []
        if !privateInput {
            if userInControl { reasons.insert("user_control") }
            if !fullAccess && !allowedApps.contains(app.bundleIdentifier ?? "") { reasons.insert("app_permission") }
            // Inspect roles before reading any values. Secure fields never
            // contribute their labels, values or pixels to model observations.
            var queue = [element], visited = 0
            while let node = queue.popLast(), visited < 5000 {
                visited += 1
                if axString(node, kAXSubroleAttribute) == kAXSecureTextFieldSubrole { reasons.insert("secret_input") }
                let label = name(node).lowercased()
                if ["one-time", "verification code", "security code", "authenticator"].contains(where: label.contains) { reasons.insert("otp"); reasons.insert("secret_input") }
                if ["captcha", "verify you are human", "not a robot"].contains(where: label.contains) { reasons.insert("captcha") }
                if let children = axValue(node, kAXChildrenAttribute) as? [AXUIElement] { queue.append(contentsOf: children.prefix(5001)) }
                if queue.count > 10000 { reasons.insert("unknown"); break }
            }
            if !queue.isEmpty { reasons.insert("unknown") }
        }
        var result: [String: Any] = ["level": reasons.isEmpty ? "routine" : "takeover", "reason_codes": reasons.sorted(),
                                     "safe_to_capture": reasons.isEmpty, "safe_to_send_to_model": reasons.isEmpty]
        if reasons.contains("app_permission") { result["required_app"] = app.bundleIdentifier ?? "" }
        return result
    }

    func name(_ node: AXUIElement) -> String {
        for attribute in [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute] {
            let text = axString(node, attribute)
            if !text.isEmpty { return String(text.prefix(2000)) }
        }
        return ""
    }

    func describe(_ node: AXUIElement) -> [String: Any] {
        let role = axString(node, kAXRoleAttribute)
        let ref: String
        if let existing = references.first(where: { CFEqual($0.value.element, node) && $0.value.role == role && $0.value.name == name(node) }) { ref = existing.key }
        else {
            if references.count >= 2000 { clearReferences() }
            ref = "\(id):\(revision):\(UUID().uuidString)"; references[ref] = Reference(element: node, role: role, name: name(node))
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
        for (key, attribute) in [("enabled", kAXEnabledAttribute), ("focused", kAXFocusedAttribute), ("selected", kAXSelectedAttribute), ("expanded", kAXExpandedAttribute)] {
            if let value = axValue(node, attribute) as? NSNumber { states[key] = value.boolValue }
        }
        var output: [String: Any] = ["ref": ref, "role": role, "platform_role": role, "name": name(node), "states": states, "actions": operations, "platform_actions": supported]
        if axString(node, kAXSubroleAttribute) != kAXSecureTextFieldSubrole {
            if let value = axValue(node, kAXValueAttribute) as? String { output["value"] = String(value.prefix(2000)) }
            else if let value = axValue(node, kAXValueAttribute) as? NSNumber { output["value"] = value }
        }
        if let bounds = axRect(node), let window = axRect(element) {
            output["bounds"] = ["x": bounds.minX - window.minX, "y": bounds.minY - window.minY, "width": bounds.width, "height": bounds.height]
        }
        return output
    }

    func observe(_ args: [String: Any]) throws -> [String: Any] {
        let limit = args["limit"] as? Int ?? 200
        guard limit > 0 && limit <= 1000 else { throw NativeInput.invalid("Observation limit must be between 1 and 1000.") }
        let root = try (args["root_ref"] as? String).map { try resolve(["ref": $0]) } ?? element
        var queue = [root], nodes: [[String: Any]] = [], visited = 0
        while !queue.isEmpty && nodes.count < limit && visited < 5000 {
            let node = queue.removeFirst(); visited += 1
            if !axString(node, kAXRoleAttribute).isEmpty { nodes.append(describe(node)) }
            if let children = axValue(node, kAXChildrenAttribute) as? [AXUIElement] { queue.append(contentsOf: children.prefix(1001)) }
        }
        return ["document_id": "\(id):\(revision)", "nodes": nodes, "truncated": !queue.isEmpty, "execution_mode": "background"]
    }

    func resolve(_ selector: [String: Any]) throws -> AXUIElement {
        try validate()
        if let ref = selector["ref"] as? String {
            guard let reference = references[ref], contains(reference.element), reference.role == axString(reference.element, kAXRoleAttribute), reference.name == name(reference.element) else { throw HostFailure(code: "STALE_REFERENCE", message: "Observe the window again.") }
            return reference.element
        }
        guard let role = selector["role"] as? String, let name = selector["name"] as? String else { throw NativeInput.invalid("A reference or role and name is required.") }
        var queue = [element], matches: [AXUIElement] = [], visited = 0
        while let node = queue.popLast(), visited < 5000 {
            visited += 1
            if axString(node, kAXRoleAttribute) == role && self.name(node) == name { matches.append(node) }
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
        case "read": return ["node": describe(node)]
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
            catch let error as HostFailure where ["ELEMENT_NOT_FOUND", "STALE_REFERENCE"].contains(error.code) { }
            if (state == "hidden" && !found) || (state == "visible" && found) || (state == "enabled" && enabled) { return ["state": state] }
            guard Date() < deadline else { return ["state": "timeout", "requested_state": state, "last_known": ["found": found, "enabled": enabled]] }
            if !changed { CFRunLoopRunInMode(.defaultMode, deadline.timeIntervalSinceNow, true) }
        }
    }
}

final class NativeAccessibility {
    var windows: [String: NativeWindow] = [:]

    func inventory() throws -> [[String: Any]] {
        guard AXIsProcessTrusted() else { throw HostFailure(code: "TARGET_PERMISSION_REQUIRED", message: "Allow Accessibility in System Settings.") }
        let excluded = try NativeScreenCapture.excludedOwner(environment: ProcessInfo.processInfo.environment)
        guard let cgWindows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] else { throw NativeInput.unavailable() }
        windows = windows.filter { (try? $0.value.validate()) != nil }
        var result: [[String: Any]] = []
        for app in NSWorkspace.shared.runningApplications where app.activationPolicy != .prohibited && app.processIdentifier != excluded {
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
