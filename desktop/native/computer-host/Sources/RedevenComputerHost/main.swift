import FloeNativeDesktop
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import CryptoKit
import ImageIO
import UniformTypeIdentifiers

// Establish the independent Launch Services identity before any privacy API.
do {
    if try !NativeApplicationBridge.attach() {
        let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.resolvingSymlinksInPath()
        let root = executable.deletingLastPathComponent()
        let candidates = ["Redeven Desktop Access.app", "Redeven Desktop Access Dev.app"]
            .map { root.appendingPathComponent($0) }
            .filter { FileManager.default.fileExists(atPath: $0.path) }
        guard candidates.count == 1 else { throw NativeApplicationBridge.Failure.invalidBundle }
        var environment: [String: String] = [:]
        if let excluded = try NativeScreenCapture.excludedOwner(environment: ProcessInfo.processInfo.environment) {
            environment["REDEVEN_COMPUTER_EXCLUDED_WINDOW_OWNER_PID"] = String(excluded)
        }
        let media = ProcessInfo.processInfo.environment["REDEVEN_HOST_MEDIA_FD"] == "3" ? Int32(3) : nil
        exit(try NativeApplicationBridge.relay(bundle: candidates[0], arguments: Array(CommandLine.arguments.dropFirst()), mediaFD: media, environment: environment))
    }
} catch {
    FileHandle.standardError.write(Data("Desktop Access could not start: \(error)\n".utf8))
    exit(1)
}

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

func screenshot(_ window: NativeWindow, modelAnchor: Bool = false) throws -> [String: Any] {
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
    var geometry: [String: Any] = [:]
    if modelAnchor {
        guard axRect(window.element) == bounds else { throw NativeInput.unavailable() }
        let digest = SHA256.hash(data: data as Data).map { String(format: "%02x", $0) }.joined()
        let anchor = ModelImageGeometry(frame: "computer://" + window.id + "/" + digest,
            documentID: UUID().uuidString, bounds: bounds, width: width, height: height)
        window.modelImage = anchor
        window.changed = false
        geometry = ["frame_geometry": anchor.payload]
    }
    return geometry.merging(["screenshot_mime": "image/png", "screenshot_base64": (data as Data).base64EncodedString(),
            "width": width, "height": height, "device_pixel_ratio": 1]) { _, new in new }
}

if CommandLine.arguments.contains("--host-applications") {
    HostApplications.run()
    exit(0)
}

let accessibility = NativeAccessibility()
let foreground = NativeForegroundInput()

func handle(_ line: String) {
    foreground.resetProgress()
    var envelope: [String: Any] = ["type": "error", "request_id": "", "target_id": ""]
    var window: NativeWindow?
    var effectStarted = false
    var inputConfirmed = false
    var privateRequest = false
    var requestAllowedApps: [String] = []
    var requestFullAccess = false
    var observationStage = "safety_scan"
    var observing = false
    do {
        try execution.check()
        guard line.utf8.count <= 262144,
              let request = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
              let id = request["request_id"] as? String, !id.isEmpty,
              let target = request["target_id"] as? String, !target.isEmpty,
              let tool = request["tool_name"] as? String,
              let args = request["args"] as? [String: Any] else { throw NativeInput.invalid("Expected a versioned JSONL request.") }
        envelope["request_id"] = id; envelope["target_id"] = target
        guard request["protocol_version"] as? Int == 4 else { throw HostFailure(code: "PROTOCOL_VERSION_MISMATCH", message: "Computer host protocol version 4 is required.") }
        if tool == "computer.targets" && target == "desktop-main" {
            emit(["type": "result", "request_id": id, "target_id": target, "payload": ["targets": try accessibility.inventory()]])
            return
        }
        if tool == "computer.applications" && target == "desktop-main" {
            guard let query = args["query"] as? String else { throw NativeInput.invalid("An application query is required.") }
            emit(["type": "result", "request_id": id, "target_id": target, "payload": ["applications": try accessibility.applications(query: query)]])
            return
        }
        if tool == "computer.open_application" && target == "desktop-main" {
            guard let application = args["application_id"] as? String, let bundle = args["app_bundle_id"] as? String else { throw NativeInput.invalid("A discovered application is required.") }
            let targets = try accessibility.openApplication(id: application, bundleID: bundle, fullAccess: request["full_access"] as? Bool == true, allowedApps: request["allowed_apps"] as? [String] ?? [], allowForeground: request["allow_foreground"] as? Bool == true, started: {
                effectStarted = true
                emit(["type": "started", "request_id": id, "target_id": target, "execution_mode": "foreground"])
            })
            emit(["type": "result", "request_id": id, "target_id": target, "payload": ["targets": targets, "action_executed": true]])
            return
        }
        guard let selected = accessibility.windows[target] else { throw HostFailure(code: "TARGET_CONNECTION_REQUIRED", message: "Select an application window before using it.") }
        window = selected; foreground.target = selected
        let privateInput = request["user_control"] as? Bool == true
        privateRequest = privateInput
        let returning = request["recovery_observation"] as? Bool == true
        let fullAccess = request["full_access"] as? Bool == true
        let allowForeground = fullAccess || request["allow_foreground"] as? Bool == true
        let allowedApps = request["allowed_apps"] as? [String] ?? []
        requestAllowedApps = allowedApps; requestFullAccess = fullAccess
        if returning {
            guard ["computer.observe", "computer.screenshot"].contains(tool) else { throw NativeInput.invalid("Recovery requires a fresh observation.") }
            selected.resumeObservation()
        }
        if privateInput {
            guard ["computer.screenshot", "computer.click", "computer.key", "computer.type", "computer.scroll"].contains(tool) else { throw NativeInput.invalid("Unsupported private input.") }
        }
        func pause(_ safety: [String: Any]) {
            selected.pause(Set(safety["reason_codes"] as? [String] ?? []))
            emit(["type": "result", "request_id": id, "target_id": target, "safety": safety,
                  "payload": ["code": "TAKEOVER_REQUIRED", "action_executed": inputConfirmed && effectStarted, "input_progress": foreground.inputProgress]])
        }
        observing = true
        let before = try selected.safety(allowedApps: allowedApps, fullAccess: fullAccess, privateInput: privateInput)
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
            if args["coordinate_space"] != nil || args["frame"] != nil || args["document_id"] != nil {
                guard args["coordinate_space"] as? String == "model_pixels", let anchor = selected.modelImage else {
                    throw HostFailure(code: "STALE_REFERENCE", message: "Capture a fresh model screenshot.")
                }
                return try anchor.point(x: number(x), y: number(y), frame: text("frame"), document: text("document_id"), currentBounds: bounds, changed: selected.changed)
            }
            let local = CGPoint(x: try number(x), y: try number(y))
            guard CGRect(origin: .zero, size: bounds.size).contains(local) else { throw NativeInput.invalid("Coordinates are outside the target window.") }
            return CGPoint(x: bounds.minX + local.x, y: bounds.minY + local.y)
        }
        var payload: [String: Any] = [:]
        var input = NativeInputSequence(events: [])
        var focusElement: AXUIElement?
        var mode = "background"
        var directedInput = false
        var clipboardBefore: Int?
        var editingAction: String?
        var editingValueBefore: String?
        func mouseButton() throws -> CGMouseButton {
            switch args["button"] as? String ?? "left" {
            case "left":return .left
            case "right":return .right
            case "middle":return .center
            default:throw NativeInput.invalid("Unsupported mouse button.")
            }
        }
        func modifiers() throws -> CGEventFlags {
            var flags:CGEventFlags=[]
            for name in args["modifiers"] as? [String] ?? [] {
                switch name {case "Alt":flags.insert(.maskAlternate);case "Control":flags.insert(.maskControl);case "Meta":flags.insert(.maskCommand);case "Shift":flags.insert(.maskShift);default:throw NativeInput.invalid("Unsupported modifier.")}
            }
            return flags
        }
        func targetPoint() throws -> CGPoint {
            if let selector=args["selector"] as? [String:Any] {
                guard let rect=axRect(try selected.resolve(selector)) else {throw NativeInput.unavailable()}
                return CGPoint(x:rect.midX,y:rect.midY)
            }
            return try point("x","y")
        }
        let beforeInput = foreground.inputCount
        let beforeApplication = NSWorkspace.shared.frontmostApplication?.processIdentifier
        let beforePointer = CGEvent(source: nil)?.location
        observing = false
        switch tool {
        case "computer.screenshot": break
        case "computer.observe":
            observing = true
            observationStage = "semantic_read"
            payload["observation"] = try selected.observe(args)
        case "computer.action":
            let action = args["action"] as? String ?? ""
            if ["read", "wait", "source", "selection", "capabilities"].contains(action) {
                observing = true; observationStage = "semantic_read"
                payload = try selected.action(args)
            }
            else if ["fill", "click", "select_text", "select_range", "select_all", "replace_selection", "set_value", "perform_action"].contains(action) && !(action == "click" && (args["button"] != nil || args["modifiers"] != nil || args["click_count"] != nil || args["duration_ms"] != nil)) {
                // AX permission does not promise that an application will stay
                // in the background. Announce and authorize that possibility
                // before dispatch; do not activate the app merely to use AX.
                try foreground.post(NativeInputSequence(events: []), window: selected, allowed: allowForeground, privateInput: privateInput, activate: false, started: {
                    emit(["type": "started", "request_id": id, "target_id": target, "execution_mode": "foreground", "reason": "application_may_activate"])
                }, prepare: {
                    payload = try selected.action(args, willMutate: { effectStarted = true; foreground.markActionStarted() })
                    if beforeApplication != NSWorkspace.shared.frontmostApplication?.processIdentifier || beforePointer != CGEvent(source: nil)?.location { mode = "foreground" }
                }, didPost: {})
            }
            else if action == "clipboard" {
                guard fullAccess else {throw HostFailure(code:"TARGET_PERMISSION_REQUIRED",message:"System clipboard access requires full access.")}
                let operation=args["operation"] as? String ?? ""
                if operation=="types" {payload=["types":NSPasteboard.general.pasteboardItems?.map{$0.types.map{$0.rawValue}} ?? [],"scope":"system_clipboard"]}
                else if operation=="read" {payload=["items":try NativeClipboard.read(maximumBytes:65536).items.map{$0.mapValues{$0.base64EncodedString()}},"scope":"system_clipboard"]}
                else if operation=="write" {
                    guard let encoded=args["items"] as? [[String:String]] else {throw NativeInput.invalid("Clipboard items are required.")}
                    let items=try encoded.map{try $0.mapValues{guard let data=Data(base64Encoded:$0) else {throw NativeInput.invalid("Invalid clipboard data.")};return data}}
                    effectStarted=true;let version=try NativeClipboard.write(items,maximumBytes:65536);payload=["written":true,"change_count":version,"scope":"system_clipboard"]
                }else {throw NativeInput.invalid("Unsupported clipboard operation.")}
            }
            else if ["copy","cut","paste"].contains(action) {
                guard allowForeground else {throw HostFailure(code:"FOREGROUND_PERMISSION_REQUIRED",message:"Native editing commands require temporary foreground access.")}
                if action=="paste" && !fullAccess {throw HostFailure(code:"TARGET_PERMISSION_REQUIRED",message:"System clipboard paste requires full access.")}
                if let selector=args["selector"] as? [String:Any] {focusElement=try selected.resolve(selector)}
                if action=="paste", args["text"] != nil || args["html"] != nil {
                    var item:[String:Data]=[:]
                    if let text=args["text"] as? String {item[NSPasteboard.PasteboardType.string.rawValue]=Data(text.utf8)}
                    if let html=args["html"] as? String {item[NSPasteboard.PasteboardType.html.rawValue]=Data(html.utf8)}
                    effectStarted=true;let version=try NativeClipboard.write([item],maximumBytes:65536)
                    payload["clipboard_change_count"]=version;payload["clipboard_restored"]=false;payload["clipboard_restore_reason"]="paste_consumption_unverified"
                }
                editingAction=action
                if let node=focusElement { editingValueBefore=axValue(node,kAXValueAttribute) as? String }
                if action=="copy" || action=="cut" {clipboardBefore=NSPasteboard.general.changeCount}
                input=NativeInputSequence(events:try NativeInput.key(action=="copy" ? "Meta+c":action=="cut" ? "Meta+x":"Meta+v"))
                // AppKit editing shortcuts require the target's active responder chain.
                // Choose the authorized foreground route before posting anything;
                // a delivered background chord is never retried as foreground input.
                payload["mechanism"]="foreground_keyboard";payload["effect_verified"]=false
            }
            else if action == "input_sequence" {
                guard let records=args["events"] as? [[String:Any]], let rect=axRect(selected.element) else {throw NativeInput.invalid("Input events and target bounds are required.")}
                input=try nativeExplicitInput(records,bounds:rect,fullAccess:fullAccess)
                directedInput=true
                payload["mechanism"]="directed_input_sequence"
            }
            else if action == "hover" {input=NativeInputSequence(events:[try NativeInput.pointer(at:targetPoint())]);directedInput=true}
            else if action == "pointer_click" || action == "click" {
                input=try NativeInput.clickSequence(at:targetPoint(),button:mouseButton(),count:args["click_count"] as? Int ?? 1,modifiers:modifiers(),holdMilliseconds:nativeDragDuration(number("duration_ms",default:0)))
                directedInput=true
            }
            else if action == "drag" { input = try NativeInput.dragSequence(from: point("from_x", "from_y"), to: point("to_x", "to_y"), durationMilliseconds: nativeDragDuration(number("duration_ms", default: 0)), button:mouseButton(),modifiers:modifiers()); directedInput=true }
            else if action == "key" {
                if let selector = args["selector"] as? [String: Any] {
                    focusElement = try selected.resolve(selector)
                }
                input = NativeInputSequence(events: try NativeInput.key(text("key")))
            } else if action == "scroll" {
                guard let selector = args["selector"] as? [String: Any], let rect = axRect(try selected.resolve(selector)) else { throw NativeInput.invalid("A scroll control is required.") }
                input = NativeInputSequence(events: try NativeInput.scroll(at: CGPoint(x: rect.midX, y: rect.midY), x: number("delta_x", default: 0), y: number("delta_y"), naturalScrolling: UserDefaults.standard.bool(forKey: "com.apple.swipescrolldirection")))
            } else { throw NativeInput.invalid("Unsupported semantic action.") }
        case "computer.wait":
            let milliseconds = try number("milliseconds", default: 0)
            guard (0...30000).contains(milliseconds) else { throw NativeInput.invalid("Wait exceeds its limit.") }
            let until = Date().addingTimeInterval(milliseconds / 1000)
            while Date() < until && !selected.isPaused { try execution.check(); CFRunLoopRunInMode(.defaultMode, until.timeIntervalSinceNow, true) }
        case "computer.click", "computer.double_click": input = NativeInputSequence(events: try NativeInput.click(at: point("x", "y"), count: tool == "computer.double_click" ? 2 : 1))
        case "computer.drag": input = try NativeInput.dragSequence(from: point("from_x", "from_y"), to: point("to_x", "to_y"), durationMilliseconds: nativeDragDuration(number("duration_ms", default: 0)))
        case "computer.type": input = NativeInputSequence(events: try NativeInput.text(text("text")))
        case "computer.key": input = NativeInputSequence(events: try NativeInput.key(text("key")))
        case "computer.scroll":
            guard let bounds = axRect(selected.element) else { throw NativeInput.unavailable() }
            let scrollPoint = args["x"] != nil || args["y"] != nil ? try point("x", "y") : CGPoint(x: bounds.midX, y: bounds.midY)
            input = NativeInputSequence(events: try NativeInput.scroll(at: scrollPoint, x: number("delta_x", default: 0), y: number("delta_y"), naturalScrolling: UserDefaults.standard.bool(forKey: "com.apple.swipescrolldirection")))
        default: throw HostFailure(code: "TARGET_CAPABILITY_UNAVAILABLE", message: "The application target does not support this tool.")
        }
        if !input.events.isEmpty {
            selected.modelImage = nil
            let prepare = {
                if let node = focusElement {
                    guard AXUIElementSetAttributeValue(node,kAXFocusedAttribute as CFString,kCFBooleanTrue) == .success else {throw NativeInput.unavailable()}
                }
            }
            if directedInput && !privateInput {
                try foreground.postDirected(input,window:selected,started:{
                    emit(["type":"started","request_id":id,"target_id":target,"execution_mode":"background"])
                },prepare:prepare,didPost:{effectStarted=true})
            }else {
                mode="foreground"
                try foreground.post(input,window:selected,allowed:allowForeground,privateInput:privateInput,started:{
                    emit(["type":"started","request_id":id,"target_id":target,"execution_mode":"foreground","reason":"native_input_required"])
                },prepare:prepare,didPost:{effectStarted=true},settle:{
                    guard let action=editingAction else {return}
                    let until=ProcessInfo.processInfo.systemUptime+0.5
                    repeat {
                        try execution.check();try selected.validate()
                        let clipboardChanged=clipboardBefore.map { NSPasteboard.general.changeCount != $0 } ?? true
                        let valueChanged=editingValueBefore.flatMap { before in focusElement.map { axString($0,kAXValueAttribute) != before } } ?? false
                        if action=="copy" && clipboardChanged || action=="cut" && clipboardChanged && valueChanged || action=="paste" && valueChanged {break}
                        CFRunLoopRunInMode(.defaultMode,0.01,false)
                    } while ProcessInfo.processInfo.systemUptime<until
                    if let before=editingValueBefore,let node=focusElement {payload["value_changed"]=axString(node,kAXValueAttribute) != before}
                })
            }
        }

        if let version=clipboardBefore {
            payload["clipboard_changed"]=NSPasteboard.general.changeCount != version
            payload["clipboard_change_count"]=NSPasteboard.general.changeCount
        }
        if effectStarted { selected.modelImage = nil }
        inputConfirmed = true
        observing = true
        observationStage = "safety_scan"
        effectStarted = effectStarted || payload["action_executed"] as? Bool == true
        try execution.check()
        if privateInput {
            selected.pause(["user_control"])
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
        observationStage = "safety_scan"
        let after = try selected.safety(allowedApps: allowedApps, fullAccess: fullAccess)
        if after["level"] as? String == "takeover" { pause(after); return }
        if tool == "computer.screenshot" || (tool == "computer.observe" ? args["screenshot"] as? Bool == true : request["script_operation"] as? Bool != true) {
            observationStage = "capture"
            payload.merge(try screenshot(selected, modelAnchor: !privateInput && request["live_frame"] as? Bool != true)) { _, new in new }
            CFRunLoopRunInMode(.defaultMode, 0, true)
            observationStage = "safety_scan"
            let captured = try selected.safety(allowedApps: allowedApps, fullAccess: fullAccess)
            if captured["level"] as? String == "takeover" { pause(captured); return }
        }
        payload["input_progress"] = foreground.inputProgress
        payload["summary"] = tool; payload["action_executed"] = effectStarted
        payload["execution_mode"] = mode; payload["execution_location"] = "macos_desktop"
        emit(["type": "result", "request_id": id, "target_id": target, "payload": payload, "safety": after])
    } catch {
        let receiptFailure = error as? NativeInputDeliveryFailure
        let failure = error as? HostFailure ?? HostFailure(code: receiptFailure == nil ? "INVALID_REQUEST" : "INPUT_UNCONFIRMED", message: receiptFailure == nil ? "Unable to process the computer host request." : "macOS input delivery was not confirmed.")
        if ["TAKEOVER_REQUIRED", "FOREGROUND_PERMISSION_REQUIRED"].contains(failure.code) {
            if failure.code == "FOREGROUND_PERMISSION_REQUIRED" { window?.pause(["foreground_permission"]) }
            envelope["type"] = "result"
            envelope["safety"] = ["level": "takeover", "reason_codes": window?.pauseReasons.sorted() ?? [], "safe_to_capture": false, "safe_to_send_to_model": false]
            envelope["payload"] = ["code": "TAKEOVER_REQUIRED", "action_executed": inputConfirmed && effectStarted, "input_progress": foreground.inputProgress]
        } else if nativeFailureCode(failure.code, observing: observing, effectStarted: effectStarted, inputConfirmed: inputConfirmed) == "TARGET_OBSERVATION_UNAVAILABLE" {
            envelope["error_code"] = "TARGET_OBSERVATION_UNAVAILABLE"
            envelope["payload"] = ["action_executed": effectStarted, "input_progress": foreground.inputProgress, "observation_stage": observationStage]
        } else {
            let uncertain = nativeFailureCode(failure.code, observing: observing, effectStarted: effectStarted, inputConfirmed: inputConfirmed) == "EFFECT_OUTCOME_UNKNOWN"
            envelope["error_code"] = uncertain ? "EFFECT_OUTCOME_UNKNOWN" : failure.code
            envelope["error"] = uncertain ? "Input was posted but its delivery is unconfirmed. Inspect current state before another action." : failure.message
            var facts: [String: Any] = ["action_executed": inputConfirmed && effectStarted,
                "input_progress": foreground.inputProgress, "stage": foreground.inputProgress["stage"] ?? (uncertain ? "action" : "preparation"),
                "reason": receiptFailure?.reason.rawValue ?? nativeFailureReason(failure.code)]
            // Recovery is one bounded, same-target semantic read. Recheck safety
            // after reading, so takeover/cancellation never releases captured text.
            if uncertain && !privateRequest && (try? execution.check()) != nil, let window, !window.isPaused {
                facts["target_state"] = "unknown"
                let deadline = ProcessInfo.processInfo.systemUptime + 1
                let check = {
                    try execution.check()
                    guard !window.isPaused, ProcessInfo.processInfo.systemUptime < deadline else {
                        throw NativeInput.unavailable()
                    }
                }
                do {
                    try check()
                    let safety = try window.safety(allowedApps: requestAllowedApps, fullAccess: requestFullAccess, check: check)
                    guard safety["safe_to_send_to_model"] as? Bool == true else { throw NativeInput.unavailable() }
                    let observation = try window.observe(["limit": 20], check: check)
                    let after = try window.safety(allowedApps: requestAllowedApps, fullAccess: requestFullAccess, check: check)
                    try check()
                    if after["safe_to_send_to_model"] as? Bool == true {
                        facts["observation"] = observation
                        facts["target_state"] = "available"
                    }
                } catch {
                    if let failure = error as? HostFailure, failure.code == "TARGET_CONNECTION_REQUIRED" {
                        facts["target_state"] = "unavailable"
                    }
                }
            }
            envelope["payload"] = facts
        }
        emit(envelope)
    }
}

if CommandLine.arguments.contains("--capabilities") {
    emit(["protocol_version": 4, "screen_recording": CGPreflightScreenCaptureAccess(), "accessibility": AXIsProcessTrusted(),
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
                if request["type"] as? String == "cancel" && request["protocol_version"] as? Int == 4 {
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
