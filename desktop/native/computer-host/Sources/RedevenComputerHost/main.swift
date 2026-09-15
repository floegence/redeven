import ApplicationServices
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

func screenshot() throws -> [String: Any] {
    guard CGPreflightScreenCaptureAccess() else {
        throw HostFailure(code: "TARGET_PERMISSION_REQUIRED", message: "Allow Screen Recording for Redeven Desktop in System Settings.")
    }
    let display = CGMainDisplayID()
    let bounds = CGDisplayBounds(display)
    let excludedOwner = try NativeScreenCapture.excludedOwner(environment: ProcessInfo.processInfo.environment)
    let image = try NativeScreenCapture.capture(displayID: display, excludedOwner: excludedOwner)
    // Model coordinates and mouse input share logical display points, even on
    // Retina displays. Normalize the returned pixels to that same viewport.
    let width = Int(bounds.width), height = Int(bounds.height)
    guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                  bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        throw HostFailure(code: "FRAME_UNAVAILABLE", message: "macOS could not allocate the frame.")
    }
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    guard let normalized = context.makeImage() else {
        throw HostFailure(code: "FRAME_UNAVAILABLE", message: "macOS could not normalize the frame.")
    }
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
        throw HostFailure(code: "FRAME_UNAVAILABLE", message: "macOS could not encode the frame.")
    }
    CGImageDestinationAddImage(destination, normalized, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw HostFailure(code: "FRAME_UNAVAILABLE", message: "macOS could not finish encoding the frame.")
    }
    return ["screenshot_mime": "image/png", "screenshot_base64": (data as Data).base64EncodedString(),
            "width": width, "height": height, "device_pixel_ratio": 1]
}

if CommandLine.arguments.contains("--capabilities") {
    emit(["protocol_version": 1, "screen_recording": CGPreflightScreenCaptureAccess(),
          "accessibility": AXIsProcessTrusted(), "execution_location": "macos_desktop"])
} else {
    while let line = readLine() {
        var envelope: [String: Any] = ["type": "error", "request_id": "", "target_id": ""]
        do {
            guard let request = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                  let id = request["request_id"] as? String, !id.isEmpty,
                  let target = request["target_id"] as? String, !target.isEmpty,
                  let tool = request["tool_name"] as? String,
                  let args = request["args"] as? [String: Any] else {
                throw NativeInput.invalid("Expected a versioned JSONL request.")
            }
            envelope["request_id"] = id; envelope["target_id"] = target
            guard request["protocol_version"] as? Int == 1 else {
                throw HostFailure(code: "PROTOCOL_VERSION_MISMATCH", message: "Computer host protocol version 1 is required.")
            }
            guard target == "desktop-main" || target == "desktop.screen" else {
                throw HostFailure(code: "TARGET_NOT_ALLOWED", message: "This helper has no binding for the requested target.")
            }
            func number(_ key: String, default fallback: Double? = nil) throws -> Double {
                guard let value = args[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID() else {
                    if let fallback, args[key] == nil { return fallback }
                    throw NativeInput.invalid("A numeric \(key) is required.")
                }
                guard value.doubleValue.isFinite else { throw NativeInput.invalid("Finite coordinates are required.") }
                return value.doubleValue
            }
            func text(_ key: String) throws -> String {
                guard let value = args[key] as? String else { throw NativeInput.invalid("A string \(key) is required.") }
                return value
            }
            var events: [CGEvent] = []
            var wait = 0.0
            switch tool {
            case "computer.screenshot": break
            case "computer.wait":
                wait = try number("milliseconds", default: 0)
                guard (0...30_000).contains(wait) else { throw NativeInput.invalid("Wait must be between 0 and 30000 milliseconds.") }
            case "computer.drag":
                let from = CGPoint(x: try number("from_x"), y: try number("from_y"))
                let to = CGPoint(x: try number("to_x"), y: try number("to_y"))
                let duration = Int(try number("duration_ms", default: 0))
                events = try NativeInput.drag(from: from, to: to, durationMilliseconds: duration)
            case "computer.click", "computer.double_click":
                let point = try CGPoint(x: number("x"), y: number("y"))
                let bounds = CGDisplayBounds(CGMainDisplayID())
                guard CGRect(origin: .zero, size: bounds.size).contains(point) else { throw NativeInput.invalid("Coordinates are outside the display viewport.") }
                events = try NativeInput.click(at: CGPoint(x: point.x + bounds.minX, y: point.y + bounds.minY), count: tool == "computer.double_click" ? 2 : 1)
            case "computer.type": events = try NativeInput.text(text("text"))
            case "computer.key": events = try NativeInput.key(text("key"))
            case "computer.scroll":
                let naturalScrolling = UserDefaults.standard.object(forKey: "com.apple.swipescrolldirection") as? Bool ?? true
                // AppKit routes wheel events by the current pointer location.
                // Establish it explicitly before synthetic scrolling; relying
                // on the previous click is not reliable across NSScrollView
                // and macOS releases.
                let wheel = try NativeInput.scroll(x: number("delta_x", default: 0), y: number("delta_y"), naturalScrolling: naturalScrolling)
                if let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                                      mouseCursorPosition: CGEvent(source: nil)?.location ?? .zero,
                                      mouseButton: .left) { events = [move] + wheel } else { events = wheel }
            default: throw HostFailure(code: "TARGET_CAPABILITY_UNAVAILABLE", message: "The desktop target does not support this tool.")
            }
            guard CGPreflightScreenCaptureAccess() else {
                throw HostFailure(code: "TARGET_PERMISSION_REQUIRED", message: "Allow Screen Recording for Redeven Desktop in System Settings.")
            }
            if !events.isEmpty && !AXIsProcessTrusted() {
                throw HostFailure(code: "TARGET_PERMISSION_REQUIRED", message: "Allow Accessibility for Redeven Desktop in System Settings.")
            }
            emit(["type": "started", "request_id": id, "target_id": target])
            for event in events { event.post(tap: .cghidEventTap) }
            if wait > 0 { Thread.sleep(forTimeInterval: wait / 1000) }
            // Allow posted events to reach the native application before capture.
            if !events.isEmpty { Thread.sleep(forTimeInterval: 0.1) }
            var payload = try screenshot()
            payload["summary"] = tool
            payload["execution_location"] = "macos_desktop"
            emit(["type": "result", "request_id": id, "target_id": target, "payload": payload])
        } catch {
            let failure = error as? HostFailure ?? HostFailure(code: "INVALID_REQUEST", message: "Unable to decode the computer host request.")
            envelope["error_code"] = failure.code
            envelope["error"] = failure.message
            emit(envelope)
        }
    }
}
