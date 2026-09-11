import ApplicationServices
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct Request: Codable { let protocol_version: Int; let request_id: String; let target_id: String; let tool_name: String; let args: [String: JSONValue] }
enum JSONValue: Codable { case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null
  init(from decoder: Decoder) throws { let c = try decoder.singleValueContainer(); if let v = try? c.decode(String.self) { self = .string(v) } else if let v = try? c.decode(Double.self) { self = .number(v) } else if let v = try? c.decode(Bool.self) { self = .bool(v) } else if let v = try? c.decode([String: JSONValue].self) { self = .object(v) } else if let v = try? c.decode([JSONValue].self) { self = .array(v) } else { self = .null } }
  func encode(to encoder: Encoder) throws { var c = encoder.singleValueContainer(); switch self { case .string(let v): try c.encode(v); case .number(let v): try c.encode(v); case .bool(let v): try c.encode(v); case .object(let v): try c.encode(v); case .array(let v): try c.encode(v); case .null: try c.encodeNil() } }
}

func emit(_ value: [String: Any]) { if let data = try? JSONSerialization.data(withJSONObject: value), let line = String(data: data, encoding: .utf8) { print(line); fflush(stdout) } }
func number(_ value: JSONValue?) -> CGFloat { if case .number(let n) = value { return CGFloat(n) }; return 0 }
func string(_ value: JSONValue?) -> String { if case .string(let v) = value { return v }; return "" }
func screenshotBase64() -> String? {
  guard let image = CGDisplayCreateImage(CGMainDisplayID()) else { return nil }
  let data = NSMutableData(); guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else { return nil }
  CGImageDestinationAddImage(destination, image, nil); guard CGImageDestinationFinalize(destination) else { return nil }; return (data as Data).base64EncodedString()
}

for line in FileHandle.standardInput.bytes.lines {
  guard let data = try? Data(line), let request = try? JSONDecoder().decode(Request.self, from: data) else { continue }
  emit(["type":"started", "request_id":request.request_id, "target_id":request.target_id])
  let point = CGPoint(x: number(request.args["x"]), y: number(request.args["y"]))
  if request.tool_name == "computer.click" || request.tool_name == "computer.double_click" {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: request.tool_name == "computer.double_click" ? .leftMouseDown : .leftMouseDown, mouseCursorPosition: point, mouseButton: .left) else { emit(["type":"error", "request_id":request.request_id, "target_id":request.target_id, "error":"CGEvent unavailable; grant Accessibility permission"]); continue }
    event.post(tap: .cghidEventTap); if request.tool_name == "computer.double_click" { event.post(tap: .cghidEventTap); }
  } else if request.tool_name == "computer.key" {
    emit(["type":"progress", "request_id":request.request_id, "target_id":request.target_id, "payload":["key":string(request.args["key"])]]); // keyboard mapping is intentionally completed by the host policy layer
  }
  var payload: [String: Any] = ["execution_location":"macos_desktop", "summary":request.tool_name]
  if let frame = screenshotBase64() { payload["screenshot_mime"] = "image/png"; payload["screenshot_base64"] = frame }
  emit(["type":"result", "request_id":request.request_id, "target_id":request.target_id, "payload":payload])
}
