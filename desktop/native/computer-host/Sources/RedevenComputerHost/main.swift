import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let outputLock = NSLock()
let execution = NativeExecution()

func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value),
          let line = String(data: data, encoding: .utf8) else { return }
    outputLock.lock(); defer { outputLock.unlock() }
    if ["result", "error"].contains(value["type"] as? String ?? ""), value["error_code"] as? String != "TARGET_BUSY",
       let requestID = value["request_id"] as? String { execution.finish(requestID) }
    print(line)
    fflush(stdout)
}

func screenshot(_ window: NativeWindow) throws -> [String: Any] {
    try window.validate()
    guard let bounds = axRect(window.element) else { throw NativeInput.unavailable() }
    let excluded = try NativeScreenCapture.excludedOwner(environment: ProcessInfo.processInfo.environment)
    let image = try NativeScreenCapture.captureWindow(windowID: window.windowID, owner: window.app.processIdentifier, excludedOwner: excluded)
    let width = Int(bounds.width), height = Int(bounds.height)
    guard width > 0, height > 0, width <= 16384, height <= 16384,
          let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                  bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        throw HostFailure(code: "FRAME_UNAVAILABLE", message: "macOS could not allocate the window frame.")
    }
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    guard let normalized = context.makeImage() else { throw NativeInput.unavailable() }
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else { throw NativeInput.unavailable() }
    CGImageDestinationAddImage(destination, normalized, nil)
    guard CGImageDestinationFinalize(destination) else { throw NativeInput.unavailable() }
    return ["screenshot_mime": "image/png", "screenshot_base64": (data as Data).base64EncodedString(),
            "width": width, "height": height, "device_pixel_ratio": 1]
}

let accessibility = NativeAccessibility()
let foreground = NativeForegroundInput()

func handle(_ line: String) {
    var envelope: [String: Any] = ["type": "error", "request_id": "", "target_id": ""]
    var window: NativeWindow?
    var effectStarted = false
    do {
        try execution.check()
        guard line.utf8.count <= 262144,
              let request = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
              let id = request["request_id"] as? String, !id.isEmpty,
              let target = request["target_id"] as? String, !target.isEmpty,
              let tool = request["tool_name"] as? String,
              let args = request["args"] as? [String: Any] else { throw NativeInput.invalid("Expected a versioned JSONL request.") }
        envelope["request_id"] = id; envelope["target_id"] = target
        guard request["protocol_version"] as? Int == 2 else { throw HostFailure(code: "PROTOCOL_VERSION_MISMATCH", message: "Computer host protocol version 2 is required.") }
        if tool == "computer.targets" && target == "desktop-main" {
            emit(["type": "result", "request_id": id, "target_id": target, "payload": ["targets": try accessibility.inventory()]])
            return
        }
        guard let selected = accessibility.windows[target] else { throw HostFailure(code: "TARGET_CONNECTION_REQUIRED", message: "Select an application window before using it.") }
        window = selected; foreground.target = selected
        let privateInput = request["user_control"] as? Bool == true
        let returning = request["return_control"] as? Bool == true
        let allowedApps = request["allowed_apps"] as? [String] ?? []
        if returning {
            guard tool == "computer.screenshot" else { throw NativeInput.invalid("Handback requires a fresh observation.") }
            selected.userInControl = false; selected.invalidate()
        }
        if privateInput {
            guard ["computer.screenshot", "computer.click", "computer.key", "computer.type", "computer.scroll"].contains(tool) else { throw NativeInput.invalid("Unsupported private input.") }
        }
        func pause(_ safety: [String: Any]) {
            selected.userInControl = true; selected.invalidate()
            emit(["type": "result", "request_id": id, "target_id": target, "safety": safety,
                  "payload": ["code": "TAKEOVER_REQUIRED", "action_executed": effectStarted]])
        }
        let before = try selected.safety(allowedApps: allowedApps, privateInput: privateInput)
        if before["level"] as? String == "takeover" { pause(before); return }
        func number(_ key: String, default fallback: Double? = nil) throws -> Double {
            guard let value = args[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID() else {
                if let fallback, args[key] == nil { return fallback }
                throw NativeInput.invalid("A numeric value is required.")
            }
            guard value.doubleValue.isFinite else { throw NativeInput.invalid("Finite coordinates are required.") }
            return value.doubleValue
        }
        func text(_ key: String) throws -> String {
            guard let value = args[key] as? String else { throw NativeInput.invalid("A string value is required.") }
            return value
        }
        func point(_ x: String, _ y: String) throws -> CGPoint {
            guard let bounds = axRect(selected.element) else { throw NativeInput.unavailable() }
            let local = CGPoint(x: try number(x), y: try number(y))
            guard CGRect(origin: .zero, size: bounds.size).contains(local) else { throw NativeInput.invalid("Coordinates are outside the target window.") }
            return CGPoint(x: bounds.minX + local.x, y: bounds.minY + local.y)
        }
        var payload: [String: Any] = [:]
        var events: [CGEvent] = []
        var focusElement: AXUIElement?
        var mode = "background"
        let beforeInput = foreground.inputCount
        let beforeApplication = NSWorkspace.shared.frontmostApplication?.processIdentifier
        let beforePointer = CGEvent(source: nil)?.location
        switch tool {
        case "computer.screenshot": break
        case "computer.observe": payload["observation"] = try selected.observe(args)
        case "computer.action":
            let action = args["action"] as? String ?? ""
            if ["read", "wait"].contains(action) { payload = try selected.action(args) }
            else if ["fill", "click"].contains(action) {
                // AX permission does not promise that an application will stay
                // in the background. Announce and authorize that possibility
                // before dispatch; do not activate the app merely to use AX.
                try foreground.post([], window: selected, allowed: request["allow_foreground"] as? Bool == true, privateInput: privateInput, activate: false, started: {
                    emit(["type": "started", "request_id": id, "target_id": target, "execution_mode": "foreground", "reason": "application_may_activate"])
                }, prepare: {
                    payload = try selected.action(args, willMutate: { effectStarted = true })
                    if beforeApplication != NSWorkspace.shared.frontmostApplication?.processIdentifier || beforePointer != CGEvent(source: nil)?.location { mode = "foreground" }
                }, didPost: {})
            }
            else if action == "pointer_click" { events = try NativeInput.click(at: point("x", "y"), count: 1) }
            else if action == "drag" { events = try NativeInput.drag(from: point("from_x", "from_y"), to: point("to_x", "to_y"), durationMilliseconds: Int(number("duration_ms", default: 0))) }
            else if action == "key" {
                if let selector = args["selector"] as? [String: Any] {
                    focusElement = try selected.resolve(selector)
                }
                events = try NativeInput.key(text("key"))
            } else if action == "scroll" {
                guard let selector = args["selector"] as? [String: Any], let rect = axRect(try selected.resolve(selector)) else { throw NativeInput.invalid("A scroll control is required.") }
                events = try NativeInput.scroll(at: CGPoint(x: rect.midX, y: rect.midY), x: number("delta_x", default: 0), y: number("delta_y"), naturalScrolling: UserDefaults.standard.bool(forKey: "com.apple.swipescrolldirection"))
            } else { throw NativeInput.invalid("Unsupported semantic action.") }
        case "computer.wait":
            let milliseconds = try number("milliseconds", default: 0)
            guard (0...30000).contains(milliseconds) else { throw NativeInput.invalid("Wait exceeds its limit.") }
            let until = Date().addingTimeInterval(milliseconds / 1000)
            while Date() < until && !selected.userInControl { try execution.check(); CFRunLoopRunInMode(.defaultMode, until.timeIntervalSinceNow, true) }
        case "computer.click", "computer.double_click": events = try NativeInput.click(at: point("x", "y"), count: tool == "computer.double_click" ? 2 : 1)
        case "computer.drag": events = try NativeInput.drag(from: point("from_x", "from_y"), to: point("to_x", "to_y"), durationMilliseconds: Int(number("duration_ms", default: 0)))
        case "computer.type": events = try NativeInput.text(text("text"))
        case "computer.key": events = try NativeInput.key(text("key"))
        case "computer.scroll":
            guard let bounds = axRect(selected.element) else { throw NativeInput.unavailable() }
            let scrollPoint = args["x"] != nil || args["y"] != nil ? try point("x", "y") : CGPoint(x: bounds.midX, y: bounds.midY)
            events = try NativeInput.scroll(at: scrollPoint, x: number("delta_x", default: 0), y: number("delta_y"), naturalScrolling: UserDefaults.standard.bool(forKey: "com.apple.swipescrolldirection"))
        default: throw HostFailure(code: "TARGET_CAPABILITY_UNAVAILABLE", message: "The application target does not support this tool.")
        }
        if !events.isEmpty {
            mode = "foreground"
            try foreground.post(events, window: selected, allowed: request["allow_foreground"] as? Bool == true, privateInput: privateInput, started: {
                emit(["type": "started", "request_id": id, "target_id": target, "execution_mode": "foreground", "reason": "native_input_required"])
            }, prepare: {
                if let node = focusElement {
                    guard AXUIElementSetAttributeValue(node, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success else { throw NativeInput.unavailable() }
                }
            }, didPost: { effectStarted = true })
        }
        effectStarted = effectStarted || payload["action_executed"] as? Bool == true
        try execution.check()
        if privateInput {
            selected.userInControl = true
            let privatePayload: [String: Any] = tool == "computer.screenshot" ? try screenshot(selected) : ["acknowledged": true]
            emit(["type": "result", "request_id": id, "target_id": target,
                  "payload": privatePayload])
            return
        }
        CFRunLoopRunInMode(.defaultMode, 0, true)
        let userEvents = foreground.inputCount - beforeInput
        let interference = mode == "background" && userEvents == 0 && (beforeApplication != NSWorkspace.shared.frontmostApplication?.processIdentifier || beforePointer != CGEvent(source: nil)?.location)
        payload["user_input_events"] = userEvents
        payload["background_interference"] = interference
        if interference { mode = "foreground" }
        let after = try selected.safety(allowedApps: allowedApps)
        if after["level"] as? String == "takeover" { pause(after); return }
        if tool == "computer.screenshot" || (tool == "computer.observe" ? args["screenshot"] as? Bool == true : request["script_operation"] as? Bool != true) {
            payload.merge(try screenshot(selected)) { _, new in new }
            CFRunLoopRunInMode(.defaultMode, 0, true)
            let captured = try selected.safety(allowedApps: allowedApps)
            if captured["level"] as? String == "takeover" { pause(captured); return }
        }
        payload["summary"] = tool; payload["action_executed"] = effectStarted
        payload["execution_mode"] = mode; payload["execution_location"] = "macos_desktop"
        emit(["type": "result", "request_id": id, "target_id": target, "payload": payload, "safety": after])
    } catch {
        let failure = error as? HostFailure ?? HostFailure(code: "INVALID_REQUEST", message: "Unable to decode the computer host request.")
        if ["TAKEOVER_REQUIRED", "FOREGROUND_PERMISSION_REQUIRED"].contains(failure.code) {
            window?.userInControl = true; window?.invalidate()
            envelope["type"] = "result"
            envelope["safety"] = ["level": "takeover", "reason_codes": [failure.code == "FOREGROUND_PERMISSION_REQUIRED" ? "foreground_permission" : "user_control"], "safe_to_capture": false, "safe_to_send_to_model": false]
            envelope["payload"] = ["code": "TAKEOVER_REQUIRED", "action_executed": effectStarted]
        } else {
            envelope["error_code"] = effectStarted ? "EFFECT_OUTCOME_UNKNOWN" : failure.code
            envelope["error"] = failure.message
        }
        emit(envelope)
    }
}

if CommandLine.arguments.contains("--capabilities") {
    emit(["protocol_version": 2, "screen_recording": CGPreflightScreenCaptureAccess(), "accessibility": AXIsProcessTrusted(),
          "input_monitoring": foreground.available, "execution_location": "macos_desktop"])
} else {
    // stdin is decoded off the main thread; AXObserver and the event tap retain
    // a real run loop throughout the helper lifetime and condition waits.
    DispatchQueue.global(qos: .userInitiated).async {
        defer {
            execution.cancel()
            DispatchQueue.main.async { exit(0) }
        }
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 8192)
        while true {
            // FileHandle.read(upToCount:) can wait for the entire requested
            // length on macOS pipes. POSIX read returns the available bytes,
            // keeping short requests and cancellation responsive with stdin open.
            let count = Darwin.read(STDIN_FILENO, &chunk, chunk.count)
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else { break }
            buffer.append(contentsOf: chunk.prefix(count))
            while let newline = buffer.firstIndex(of: 10) {
                let bytes = Data(buffer[..<newline])
                buffer.removeSubrange(...newline)
                guard bytes.count <= 262144, let line = String(data: bytes, encoding: .utf8),
                      let request = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                      let requestID = request["request_id"] as? String, !requestID.isEmpty else {
                    execution.cancel(); return
                }
                if request["type"] as? String == "cancel" && request["protocol_version"] as? Int == 2 {
                    execution.cancel(requestID); continue
                }
                guard execution.begin(requestID) else {
                    emit(["type": "error", "request_id": requestID, "target_id": request["target_id"] as? String ?? "",
                          "error_code": "TARGET_BUSY", "error": "Another request is executing."])
                    continue
                }
                DispatchQueue.main.async {
                    handle(line)
                }
            }
            if buffer.count > 262144 { execution.cancel(); break }
        }
    }
    RunLoop.main.run()
}
