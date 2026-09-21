import AppKit
import ApplicationServices
import CryptoKit
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

// Human-operated host application sessions are separate from Flower's versioned
// automation protocol. A session binds the catalog application returned by
// AppKit. Explicit quit uses a fresh system inventory and exact process generations;
// detaching or runtime shutdown never grants permission to terminate an app.
enum HostApplicationCatalog {
    static func identifier(_ url: URL) -> String {
        "macos-" + SHA256.hash(data: Data(url.resolvingSymlinksInPath().path.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    static func applications(extra: [URL] = []) -> [URL] {
        let manager = FileManager.default
        var found = extra + NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.compactMap(\.bundleURL)
        let roots = ["/Applications", "/System/Applications", "/System/Library/CoreServices/Applications", NSHomeDirectory() + "/Applications"]
        for root in roots {
            guard let entries = manager.enumerator(at: URL(fileURLWithPath: root), includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { continue }
            for case let url as URL in entries where url.pathExtension.lowercased() == "app" { found.append(url) }
        }
        var seen = Set<String>()
        return found.map { $0.resolvingSymlinksInPath() }.filter {
            guard let bundle = Bundle(url: $0), bundle.executableURL != nil,
                  bundle.object(forInfoDictionaryKey: "CFBundlePackageType") as? String == "APPL",
                  bundle.object(forInfoDictionaryKey: "LSBackgroundOnly") as? Bool != true else { return false }
            return seen.insert($0.path).inserted
        }.sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
    }
    static func describe(_ url: URL) -> [String: Any] {
        let bundle = Bundle(url: url)
        let name = (bundle?.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
            ?? (bundle?.object(forInfoDictionaryKey: "CFBundleName") as? String)
            ?? FileManager.default.displayName(atPath: url.path)
        let image = NSWorkspace.shared.icon(forFile: url.path)
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 64, pixelsHigh: 64, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
        var icon = ""
        if let bitmap, let graphics = NSGraphicsContext(bitmapImageRep: bitmap) {
            NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = graphics
            image.draw(in: NSRect(x: 0, y: 0, width: 64, height: 64))
            NSGraphicsContext.restoreGraphicsState()
            if let data = bitmap.representation(using: .png, properties: [:]) { icon = "data:image/png;base64," + data.base64EncodedString() }
        }
        // macOS does not provide a localized description/category for every
        // bundle. Missing metadata stays empty instead of inventing product copy.
        return ["id": identifier(url), "name": name, "description": "", "categories": [String](), "icon": icon, "custom": false]
    }
    static func instanceIdentifier(url: URL, pid: pid_t, launched: Date) -> String {
        let identity = "\(identifier(url)):\(pid):\(launched.timeIntervalSinceReferenceDate)"
        return SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    static func instanceIdentifier(_ app: NSRunningApplication) -> String? {
        guard !app.isTerminated, app.activationPolicy == .regular, let url = app.bundleURL, let date = app.launchDate else { return nil }
        return instanceIdentifier(url: url, pid: app.processIdentifier, launched: date)
    }
    static func running() -> [[String: Any]] {
        var groups: [String: [String]] = [:]
        for app in NSWorkspace.shared.runningApplications {
            guard let instance = instanceIdentifier(app), let url = app.bundleURL else { continue }
            groups[identifier(url), default: []].append(instance)
        }
        return groups.keys.sorted().map { ["application_id": $0, "instances": groups[$0]!.sorted()] }
    }
    static func quit(_ request: [String: Any]) throws {
        guard consoleAvailable else { throw NativeInput.unavailable() }
        guard let id = request["application_id"] as? String, let instances = request["instances"] as? [String],
              !instances.isEmpty, instances.count <= 64, Set(instances).count == instances.count else { throw NativeInput.invalid("An application instance is required.") }
        let targets = NSWorkspace.shared.runningApplications.filter { app in
            guard let url = app.bundleURL, identifier(url) == id, let instance = instanceIdentifier(app) else { return false }
            return instances.contains(instance)
        }
        // Validate the complete selection before making any quit request. A stale
        // snapshot must not quit a replacement process, even when its PID is reused.
        guard targets.count == instances.count else { throw HostFailure(code: "APPLICATION_NOT_FOUND", message: "The application instance is no longer running.") }
        var accepted = true
        for app in targets {
            app.unhide()
            _ = app.activate(options: [])
            if !app.terminate() { accepted = false }
        }
        guard accepted else { throw HostFailure(code: "QUIT_REJECTED", message: "The application did not accept the quit request.") }
    }
    static var consoleAvailable: Bool {
        guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
        return session[kCGSessionOnConsoleKey as String] as? Bool == true && session["CGSSessionScreenIsLocked"] as? Bool != true
    }
    static func blockReason(console: Bool, screen: Bool, accessibility: Bool) -> String? {
        if !console { return "GRAPHICAL_SESSION_REQUIRED" }
        if !screen || !accessibility { return "PERMISSION_REQUIRED" }
        return nil
    }
    static var blockReason: String? {
        blockReason(console: consoleAvailable, screen: CGPreflightScreenCaptureAccess(), accessibility: AXIsProcessTrusted())
    }
    static func availability() -> [String: Any] {
        let console = consoleAvailable, screen = CGPreflightScreenCaptureAccess(), accessibility = AXIsProcessTrusted()
        return ["supported": true, "ready": console && screen && accessibility, "native_ready": console,
                "backend": "macos", "reason": !console ? "graphical_session_required" : (!screen || !accessibility ? "macos_permissions" : ""),
                "permissions": ["screen_recording": screen, "accessibility": accessibility], "requirements": [String]()]
    }
}

// A process-scoped receipt preserves pointer/key ordering without sleeps or
// observing other applications. Unmarked input contents are never inspected.
private final class HostApplicationDelivery {
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var marker: Int64 = 0
    private var received = false
    init(pid: pid_t) {
        let types: [CGEventType] = [.keyDown, .keyUp, .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp,
                                   .otherMouseDown, .otherMouseUp, .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .scrollWheel]
        let mask = types.reduce(CGEventMask(0)) { $0 | (1 << $1.rawValue) }
        tap = CGEvent.tapCreateForPid(pid: pid, place: .tailAppendEventTap, options: .listenOnly, eventsOfInterest: mask, callback: { _, _, event, pointer in
            guard let pointer else { return Unmanaged.passUnretained(event) }
            let delivery = Unmanaged<HostApplicationDelivery>.fromOpaque(pointer).takeUnretainedValue()
            if event.getIntegerValueField(.eventSourceUserData) == delivery.marker { delivery.received = true }
            return Unmanaged.passUnretained(event)
        }, userInfo: Unmanaged.passUnretained(self).toOpaque())
        if let tap {
            source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
            if let source { CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes) }
        }
    }
    deinit {
        if let tap { CGEvent.tapEnable(tap: tap, enable: false); CFMachPortInvalidate(tap) }
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
    }
    func post(_ event: CGEvent) throws {
        guard let tap, CGEvent.tapIsEnabled(tap: tap) else { throw NativeInput.unavailable() }
        marker = Int64.random(in: 1...Int64.max); received = false
        event.setIntegerValueField(.eventSourceUserData, value: marker)
        event.post(tap: .cghidEventTap)
        let deadline = Date().addingTimeInterval(1)
        while !received && Date() < deadline { CFRunLoopRunInMode(.defaultMode, deadline.timeIntervalSinceNow, true) }
        guard received else { throw HostFailure(code: "INPUT_UNCONFIRMED", message: "The application did not receive input.") }
    }
}

final class HostApplicationSession {
    private var picture = try! HostApplicationCaptureSettings()
    private var app: NSRunningApplication?
    private let inventory = HostApplicationWindows()
    private var presence = HostApplicationWindowPresence()
    private var ownsApplication = false
    private var blockedReason: String?
    private var knownWindowIDs = Set<String>()
    private var waiting = false
    private var selected: NativeWindow?
    private var capture: HostApplicationStream?
    private var delivery: HostApplicationDelivery?
    private var timer: Timer?
    private var generation = 0
    private var selectionInFlight: Int?
    private var starting = false
    private var captureFailed = false
    private var lastInventory = ""
    private var extra: [URL] = []
    private var heldButtons = Set<Int>()
    private var menuItems: [String: AXUIElement] = [:]

    func handle(_ request: [String: Any]) {
        do {
            guard request["protocol_version"] as? Int == 1,
                  let action = request["action"] as? String else { throw NativeInput.invalid("Host application protocol version 1 is required.") }
            switch action {
            case "catalog":
                extra = (request["paths"] as? [String] ?? []).filter { $0.hasPrefix("/") && $0.hasSuffix(".app") }.map { URL(fileURLWithPath: $0) }
                emit(["type": "catalog", "availability": HostApplicationCatalog.availability(), "applications": HostApplicationCatalog.applications(extra: extra).map(HostApplicationCatalog.describe), "running": HostApplicationCatalog.running()])
            case "running": emit(["type": "running", "running": HostApplicationCatalog.running()])
            case "quit":
                try HostApplicationCatalog.quit(request)
                emit(["type": "quit_requested"])
            case "detach": end(reason: "sharing_stopped")
            case "validate":
                guard let path = request["path"] as? String, path.hasPrefix("/"), path.hasSuffix(".app") else { throw NativeInput.invalid("An absolute application bundle path is required.") }
                let url = URL(fileURLWithPath: path).resolvingSymlinksInPath()
                guard HostApplicationCatalog.applications(extra: [url]).contains(url) else { throw NativeInput.invalid("Invalid application bundle.") }
                emit(["type": "validated"])
            case "permissions":
                if request["permission"] as? String == "screen_recording" { _ = CGRequestScreenCaptureAccess() }
                else if request["permission"] as? String == "accessibility" { _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) }
                else { throw NativeInput.invalid("Unknown permission.") }
                emit(["type": "result"])
            case "launch", "native": try launch(request, native: action == "native")
            case "configure":
                let settings = try HostApplicationCaptureSettings(request: request)
                if settings != picture {
                    picture = settings
                    if let selected { try select(selected) }
                }
            case "frame_ack":
                guard request["generation"] as? Int == generation, let id = request["frame_id"] as? Int else { return }
                capture?.acknowledge(id)
            case "resume":
                blockedReason = nil
                guard checkAccess() else { return }
                releaseButtons()
                if let app { delivery = HostApplicationDelivery(pid: app.processIdentifier) }
                app?.unhide()
                captureFailed = false
                // Minimized windows can lose their old WindowServer surface.
                // Restore through AX, then resolve a fresh owned capture source.
                if let selected { AXUIElementSetAttributeValue(selected.element, kAXMinimizedAttribute as CFString, kCFBooleanFalse) }
                generation += 1
                selectionInFlight = nil
                menuItems.removeAll()
                selected = nil
                waiting = false
                refresh()
            case "select":
                guard let id = request["window"] as? String, let window = try currentWindows().windows.first(where: { $0.id == id }) else { throw NativeInput.invalid("Unknown application window.") }
                try select(window)
            case "resize":
                let window = try target(request)
                var size = CGSize(width: try number(request, "width", 320...8192), height: try number(request, "height", 200...8192))
                guard let value = AXValueCreate(.cgSize, &size), AXUIElementSetAttributeValue(window.element, kAXSizeAttribute as CFString, value) == .success else { return }
                try select(window)
            case "close":
                let window = try target(request)
                guard let button = axValue(window.element, kAXCloseButtonAttribute), CFGetTypeID(button) == AXUIElementGetTypeID(),
                      AXUIElementPerformAction(unsafeBitCast(button, to: AXUIElement.self), kAXPressAction as CFString) == .success else { throw NativeInput.unavailable() }
                // Save dialogs remain part of the live session; never force quit.
            case "stop":
                guard let app, !app.isTerminated else { end(reason: "application_exited"); return }
                if ownsApplication { _ = app.terminate() } else { end(reason: "sharing_stopped") }
            case "menu":
                let application = try menuTarget(request)
                menuItems.removeAll()
                guard let value = axValue(application, kAXMenuBarAttribute), CFGetTypeID(value) == AXUIElementGetTypeID() else { throw NativeInput.unavailable() }
                let root = unsafeBitCast(value, to: AXUIElement.self)
                var count = 0
                func items(_ node: AXUIElement, depth: Int) -> [[String: Any]] {
                    guard depth < 6, count < 500 else { return [] }
                    var result: [[String: Any]] = []
                    for child in (axValue(node, kAXChildrenAttribute) as? [AXUIElement] ?? []) {
                        count += 1
                        if count > 500 { break }
                        let title = axString(child, kAXTitleAttribute)
                        let children = items(child, depth: depth + 1)
                        if title.isEmpty { result.append(contentsOf: children); continue }
                        let id = UUID().uuidString
                        self.menuItems[id] = child
                        result.append(["id": id, "title": title, "enabled": (axValue(child, kAXEnabledAttribute) as? Bool) != false, "children": children])
                    }
                    return result
                }
                emit(["type": "menu", "generation": generation, "items": items(root, depth: 0)])
            case "menu_action":
                _ = try menuTarget(request)
                guard let id = request["item"] as? String, let item = menuItems[id], (axValue(item, kAXEnabledAttribute) as? Bool) != false else { throw NativeInput.invalid("The menu item is unavailable.") }
                _ = app?.activate(options: [])
                guard AXUIElementPerformAction(item, kAXPressAction as CFString) == .success else { throw NativeInput.unavailable() }
                menuItems.removeAll()
            case "input": try input(request)
            case "release": releaseButtons()
            default: throw NativeInput.invalid("Unknown host application action.")
            }
            if ["input", "close", "menu_action", "resize"].contains(action) && request["kind"] as? String != "move" {
                emit(["type": "operation_complete", "action": action])
            }
        } catch {
            let failure = error as? HostFailure
            let action = request["action"] as? String ?? ""
            let operation = ["input", "close", "menu", "menu_action", "resize", "select", "release", "resume", "configure", "frame_ack"].contains(action)
            if operation { releaseButtons() }
            emit(["type": operation ? "operation_error" : "error", "action": action, "code": failure?.code ?? "APPLICATION_FAILED"])
        }
    }

    private func launch(_ request: [String: Any], native: Bool) throws {
        if let paths = request["paths"] as? [String] { extra = paths.filter { $0.hasPrefix("/") && $0.hasSuffix(".app") }.map { URL(fileURLWithPath: $0) } }
        guard !starting, app == nil, HostApplicationCatalog.consoleAvailable,
              let id = request["application_id"] as? String,
              let url = HostApplicationCatalog.applications(extra: extra).first(where: { HostApplicationCatalog.identifier($0) == id }) else { throw NativeInput.invalid("The application is unavailable.") }
        if !native && (!CGPreflightScreenCaptureAccess() || !AXIsProcessTrusted()) { throw HostFailure(code: "PERMISSION_REQUIRED", message: "Authorize screen recording and accessibility on the host.") }
        let existing = Set(NSWorkspace.shared.runningApplications.map(\.processIdentifier))
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.createsNewApplicationInstance = false
        starting = true
        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { application, error in
            DispatchQueue.main.async {
                self.starting = false
                guard error == nil, let application else { emit(["type": "error", "code": "LAUNCH_FAILED"]); return }
                if native { emit(["type": "opened"]); return }
                guard application.bundleURL?.resolvingSymlinksInPath() == url else { emit(["type": "error", "code": "APPLICATION_MISMATCH"]); return }
                self.ownsApplication = !existing.contains(application.processIdentifier)
                self.app = application
                self.delivery = HostApplicationDelivery(pid: application.processIdentifier)
                emit(["type": "launched", "instance": HostApplicationCatalog.instanceIdentifier(application) ?? "", "pid": application.processIdentifier, "existing_application": !self.ownsApplication])
                self.timer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in
                    guard let self else { return }
                    if application.isTerminated {
                        self.end(reason: "application_exited"); return
                    }
                    guard self.checkAccess() else { return }
                    self.refresh()
                }
                self.refresh()
            }
        }
    }
    private func checkAccess() -> Bool {
        guard let reason = HostApplicationCatalog.blockReason else { blockedReason = nil; return true }
        if blockedReason != reason {
            blockedReason = reason
            generation += 1
            selectionInFlight = nil
            menuItems.removeAll()
            releaseButtons()
            capture?.stop(); capture = nil
            captureFailed = false
            waiting = false
            _ = presence.observe(windowCount: nil, at: Date())
            emit(["type": "blocked", "code": reason, "generation": generation])
        }
        return false
    }
    private func currentWindows() throws -> HostApplicationWindows.Snapshot {
        guard let app, !app.isTerminated else { throw NativeInput.unavailable() }
        return try inventory.snapshot(app)
    }
    private func suspendWindow() {
        guard !waiting else { return }
        waiting = true
        generation += 1
        selectionInFlight = nil
        menuItems.removeAll()
        releaseButtons()
        capture?.stop(); capture = nil
        selected = nil
        lastInventory = ""
        emit(["type": "windows", "windows": [[String: String]]()])
        emit(["type": "waiting", "generation": generation])
    }
    private func refresh() {
        let snapshot: HostApplicationWindows.Snapshot
        do { snapshot = try currentWindows() }
        catch {
            _ = presence.observe(windowCount: nil, at: Date())
            if selected == nil { suspendWindow() }
            // A failed AX read is not proof of closure. Keep the capture and
            // binding until an authoritative inventory or process exit arrives.
            return
        }
        if presence.observe(windowCount: snapshot.count, at: Date()) { end(reason: "windows_closed"); return }
        let windows = snapshot.windows
        guard !windows.isEmpty else { suspendWindow(); return }
        let list = windows.map { ["id": $0.id, "title": axString($0.element, kAXTitleAttribute)] }
        let signature = String(data: (try? JSONSerialization.data(withJSONObject: list, options: .sortedKeys)) ?? Data(), encoding: .utf8) ?? ""
        if signature != lastInventory { lastInventory = signature; emit(["type": "windows", "windows": list]) }
        // Follow a newly opened focused dialog/window without overriding an
        // explicit choice among windows that were already available.
        guard selectionInFlight == nil else { return }
        let newlyFocused = windows.first { $0.id == snapshot.focusedID && !knownWindowIDs.contains($0.id) }
        knownWindowIDs = Set(windows.map(\.id))
        if let next = newlyFocused ?? (selected == nil || !windows.contains(where: { $0.id == selected?.id }) ? windows.first : nil) {
            captureFailed = false
            try? select(next)
        } else if let selected, !captureFailed && capture == nil { try? select(selected) }
    }
    private func select(_ window: NativeWindow) throws {
        guard checkAccess() else { return }
        try window.validate()
        AXUIElementSetAttributeValue(window.element, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
        selected = window
        capture?.stop(); capture = nil
        generation += 1
        selectionInFlight = nil
        menuItems.removeAll()
        let selectionGeneration = generation
        selectionInFlight = selectionGeneration
        releaseButtons()
        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: false) { content, error in
            DispatchQueue.main.async {
                if self.selectionInFlight == selectionGeneration { self.selectionInFlight = nil }
                guard self.app != nil, self.generation == selectionGeneration else { return }
                guard let candidate = content?.windows.first(where: { $0.windowID == window.windowID && $0.owningApplication?.processID == self.app?.processIdentifier }), error == nil else {
                    self.captureFailed = true
                    emit(["type": "capture_error", "code": "CAPTURE_SOURCE_UNAVAILABLE", "generation": selectionGeneration]); return
                }
                self.capture?.stop()
                self.selected = window
                self.waiting = false
                let currentGeneration = self.generation
                let stream = HostApplicationStream(generation: currentGeneration, settings: self.picture) { [weak self] error in
                    guard let self, self.app != nil, self.generation == currentGeneration else { return }
                    let failure = error as NSError
                    if failure.domain == SCStreamErrorDomain && failure.code == SCStreamError.Code.noCaptureSource.rawValue {
                        // Closing or replacing a window ends its capture source.
                        // Only the native inventory/process can end the session.
                        self.suspendWindow()
                        self.refresh()
                        return
                    }
                    self.captureFailed = true
                    self.capture?.stop(); self.capture = nil
                    emit(["type": "capture_error", "code": "SC_\(failure.code)", "generation": currentGeneration])
                }
                self.capture = stream
                emit(["type": "window", "window": window.id, "width": candidate.frame.width, "height": candidate.frame.height, "generation": self.generation])
                stream.start(candidate)
            }
        }
    }
    private func menuTarget(_ request: [String: Any]) throws -> AXUIElement {
        // Menus belong to the bound application, including when it has no window.
        // Every capture/wait transition revokes old menu handles and generations.
        guard checkAccess(),
              let app, !app.isTerminated, request["generation"] as? Int == generation else {
            throw HostFailure(code: "STALE_WINDOW", message: "Wait for the current application.")
        }
        return AXUIElementCreateApplication(app.processIdentifier)
    }
    private func target(_ request: [String: Any]) throws -> NativeWindow {
        guard checkAccess(),
              let selected, request["window"] as? String == selected.id,
              request["generation"] as? Int == generation else { throw HostFailure(code: "STALE_WINDOW", message: "Wait for the current window.") }
        try selected.validate()
        return selected
    }
    private func number(_ request: [String: Any], _ key: String, _ range: ClosedRange<Double>) throws -> Double {
        guard let n = request[key] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite, range.contains(n.doubleValue) else { throw NativeInput.invalid("Invalid window coordinates.") }
        return n.doubleValue
    }
    private func input(_ request: [String: Any]) throws {
        let window = try target(request)
        guard let kind = request["kind"] as? String else { throw NativeInput.invalid("Missing input kind.") }
        // Explicit human input may activate this bound application. Events are
        // posted only after verifying the exact application and focused window.
        if kind != "move" {
            _ = window.app.activate(options: [])
            AXUIElementPerformAction(window.element, kAXRaiseAction as CFString)
            let deadline = Date().addingTimeInterval(1)
            while NSWorkspace.shared.frontmostApplication?.processIdentifier != window.app.processIdentifier && Date() < deadline {
                CFRunLoopRunInMode(.defaultMode, 0.01, true)
            }
        }
        if kind == "move" && NSWorkspace.shared.frontmostApplication?.processIdentifier != window.app.processIdentifier { return }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == window.app.processIdentifier,
              let focused = axValue(window.application, kAXFocusedWindowAttribute), CFEqual(focused, window.element) else {
            throw HostFailure(code: "WINDOW_NOT_FOCUSED", message: "The target window is not active.")
        }
        guard let rect = axRect(window.element) else { throw NativeInput.unavailable() }
        var events: [CGEvent] = []
        if kind == "text", let text = request["text"] as? String { events = try NativeInput.text(text); for event in events { event.flags = [] } }
        else if kind == "key", let chord = request["key"] as? String { events = try NativeInput.key(chord); events.last?.flags = [] }
        else {
            let point = CGPoint(x: rect.minX + (try number(request, "x", 0...1)) * max(0, rect.width - 1), y: rect.minY + (try number(request, "y", 0...1)) * max(0, rect.height - 1))
            // App activation and WindowServer stacking settle independently.
            // Never route a pointer event through another application's window.
            func ownsPoint() -> Bool {
                guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return false }
                for item in list {
                    guard (item[kCGWindowLayer as String] as? Int) == 0,
                          let bounds = item[kCGWindowBounds as String] as? [String: Any],
                          let frame = CGRect(dictionaryRepresentation: bounds as CFDictionary), frame.contains(point) else { continue }
                    return (item[kCGWindowOwnerPID as String] as? Int32) == window.app.processIdentifier
                }
                return false
            }
            let deadline = Date().addingTimeInterval(1)
            while kind != "move" && !ownsPoint() && Date() < deadline { CFRunLoopRunInMode(.defaultMode, 0.01, true) }
            guard ownsPoint() else {
                if kind == "move" { return }
                throw HostFailure(code: "WINDOW_NOT_FOCUSED", message: "The application window is covered.")
            }
            if kind == "scroll" { events = try NativeInput.scroll(at: point, x: number(request, "dx", -10000...10000), y: number(request, "dy", -10000...10000), naturalScrolling: UserDefaults.standard.bool(forKey: "com.apple.swipescrolldirection")) }
            else {
                let button = request["button"] as? Int ?? 0
                guard (0...2).contains(button), ["down", "up", "move"].contains(kind) else { throw NativeInput.invalid("Invalid pointer event.") }
                let type: CGEventType
                if kind == "down" { heldButtons.insert(button); type = button == 2 ? .rightMouseDown : button == 1 ? .otherMouseDown : .leftMouseDown }
                else if kind == "up" { heldButtons.remove(button); type = button == 2 ? .rightMouseUp : button == 1 ? .otherMouseUp : .leftMouseUp }
                else { type = heldButtons.contains(0) ? .leftMouseDragged : heldButtons.contains(2) ? .rightMouseDragged : heldButtons.contains(1) ? .otherMouseDragged : .mouseMoved }
                let mouse: CGMouseButton = button == 2 ? .right : button == 1 ? .center : .left
                let source = CGEventSource(stateID: .hidSystemState)
                source?.localEventsSuppressionInterval = 0
                guard let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: mouse) else { throw NativeInput.unavailable() }
                event.setIntegerValueField(.mouseEventClickState, value: Int64(min(3, max(1, request["clicks"] as? Int ?? 1))))
                if kind == "down", let move = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: mouse) { events = [move, event] }
                else { events = [event] }
            }
        }
        if kind != "text" && kind != "key" {
            var flags: CGEventFlags = []
            for modifier in request["modifiers"] as? [String] ?? [] {
                switch modifier {
                case "Meta": flags.insert(.maskCommand)
                case "Control": flags.insert(.maskControl)
                case "Alt": flags.insert(.maskAlternate)
                case "Shift": flags.insert(.maskShift)
                default: throw NativeInput.invalid("Unsupported pointer modifier.")
                }
            }
            for event in events { event.flags = flags }
        }
        for event in events {
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == window.app.processIdentifier else { throw HostFailure(code: "WINDOW_NOT_FOCUSED", message: "The user changed applications.") }
            guard let delivery else { throw NativeInput.unavailable() }
            try delivery.post(event)
        }
    }
    func releaseButtons() {
        if let app {
            for button in heldButtons {
                let type: CGEventType = button == 2 ? .rightMouseUp : button == 1 ? .otherMouseUp : .leftMouseUp
                let mouse: CGMouseButton = button == 2 ? .right : button == 1 ? .center : .left
                CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: CGEvent(source: nil)?.location ?? .zero, mouseButton: mouse)?.postToPid(app.processIdentifier)
            }
        }
        heldButtons.removeAll()
    }
    func end(reason: String = "sharing_stopped") { generation += 1; releaseButtons(); app = nil; selected = nil; delivery = nil; capture?.stop(); capture = nil; timer?.invalidate(); timer = nil; emit(["type": "ended", "end_reason": reason]) }
}

enum HostApplications {
    static func run() {
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.accessory)
        let host = HostApplicationSession()
        DispatchQueue.global(qos: .userInitiated).async {
            var buffer = Data(), chunk = [UInt8](repeating: 0, count: 8192)
            while true {
                let count = Darwin.read(STDIN_FILENO, &chunk, chunk.count)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { break }
                buffer.append(contentsOf: chunk.prefix(count))
                while let newline = buffer.firstIndex(of: 10) {
                    let line = Data(buffer[..<newline]); buffer.removeSubrange(...newline)
                    guard line.count <= 262144, let request = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { exit(2) }
                    DispatchQueue.main.sync { host.handle(request) }
                }
                if buffer.count > 262144 { exit(2) }
            }
            DispatchQueue.main.async { host.end(); exit(0) }
        }
        RunLoop.main.run()
    }
}
