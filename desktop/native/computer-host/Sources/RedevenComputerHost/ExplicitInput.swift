import AppKit
import FloeNativeDesktop

// Adapt the script's explicit transitions to the published native primitives.
// Validate the complete schedule before dispatching any event.
func nativeExplicitInput(_ records: [[String: Any]], bounds: CGRect, fullAccess: Bool) throws -> NativeInputSequence {
    guard !records.isEmpty, records.count <= 100 else { throw NativeInput.invalid("Input requires 1 to 100 transitions.") }
    let modifierCodes = ["Meta":"MetaLeft", "Control":"ControlLeft", "Alt":"AltLeft", "Shift":"ShiftLeft"]
    let modifierFlags: [String: CGEventFlags] = ["Meta":.maskCommand, "Control":.maskControl, "Alt":.maskAlternate, "Shift":.maskShift]
    var held = Set<String>(), events: [CGEvent] = [], delays: [Int] = [], pendingDelay = 0
    for record in records {
        let type = record["type"] as? String ?? ""
        let allowed: Set<String> = type == "wait" ? ["type", "duration_ms"]
            : ["keyDown", "keyUp"].contains(type) ? ["type", "key", "modifiers", "repeat"]
            : ["type", "x", "y", "button", "buttons", "modifiers", "click_count"]
        guard Set(record.keys).isSubset(of: allowed) else { throw NativeInput.invalid("Unknown input transition field.") }
        if type == "wait" {
            guard let duration = record["duration_ms"] as? Int, (0...5000).contains(duration), pendingDelay + duration <= 5000 else { throw NativeInput.invalid("Invalid input wait.") }
            pendingDelay += duration
            continue
        }
        let supplied = record["modifiers"] as? [String] ?? []
        guard record["modifiers"] == nil || record["modifiers"] is [String], supplied.allSatisfy({ modifierFlags[$0] != nil }) else { throw NativeInput.invalid("Invalid modifiers.") }
        var active = held.union(supplied)
        let event: CGEvent
        if ["keyDown", "keyUp"].contains(type) {
            guard let key = record["key"] as? String, !key.isEmpty,
                  record["repeat"] == nil || record["repeat"] is Bool else { throw NativeInput.invalid("A valid key transition is required.") }
            if modifierCodes[key] != nil {
                if type == "keyDown" { held.insert(key); active.insert(key) }
                else { held.remove(key); active.remove(key) }
                event = try NativeInput.viewerKey(["key":key, "code":modifierCodes[key]!, "pressed":type == "keyDown", "repeat":false,
                    "shiftKey":active.contains("Shift"), "ctrlKey":active.contains("Control"), "altKey":active.contains("Alt"), "metaKey":active.contains("Meta")])
            } else {
                let chord = active.sorted().map { $0 + "+" }.joined() + key
                event = try NativeInput.key(chord)[type == "keyDown" ? 0 : 1]
                event.setIntegerValueField(.keyboardEventAutorepeat, value: type == "keyDown" && record["repeat"] as? Bool == true ? 1 : 0)
                let code = event.getIntegerValueField(.keyboardEventKeycode)
                if !fullAccess && event.flags.intersection([.maskCommand,.maskControl]).isEmpty == false && [8,7,9].contains(code) {
                    throw HostFailure(code:"TARGET_PERMISSION_REQUIRED", message:"Clipboard shortcuts require full access; use explicit target editing commands.")
                }
            }
        } else {
            guard ["mouseMoved", "mousePressed", "mouseReleased"].contains(type),
                  let x = record["x"] as? Double, let y = record["y"] as? Double, x.isFinite, y.isFinite,
                  CGRect(origin:.zero,size:bounds.size).contains(CGPoint(x:x,y:y)) else { throw NativeInput.invalid("Pointer coordinates must be inside the target.") }
            let buttons = record["buttons"] as? Int ?? 0, count = record["click_count"] as? Int ?? 1
            guard (0...7).contains(buttons), (1...3).contains(count) else { throw NativeInput.invalid("Invalid buttons or click count.") }
            let button: CGMouseButton
            switch record["button"] as? String ?? "left" {
            case "left": button = .left
            case "right": button = .right
            case "middle": button = .center
            default: throw NativeInput.invalid("Unsupported mouse button.")
            }
            let flags = active.reduce(CGEventFlags()) { $0.union(modifierFlags[$1]!) }
            event = try NativeInput.pointer(at:CGPoint(x:bounds.minX+x,y:bounds.minY+y),button:button,pressed:type == "mouseMoved" ? nil : type == "mousePressed",dragging:type == "mouseMoved" && buttons > 0,modifiers:flags)
            event.setIntegerValueField(.mouseEventClickState,value:Int64(count))
        }
        events.append(event); delays.append(pendingDelay); pendingDelay = 0
    }
    guard pendingDelay == 0 else { throw NativeInput.invalid("End native input with a transition, not a wait.") }
    return try NativeInputSequence(events:events,delaysMilliseconds:delays)
}
