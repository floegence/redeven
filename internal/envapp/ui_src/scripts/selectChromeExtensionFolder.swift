import AppKit
import ApplicationServices

// Test-only native picker driver. Scope every lookup and click to the exact
// disposable Chrome process; navigate visible folders without entering paths.
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}
func children(_ element: AXUIElement) -> [AXUIElement] {
    attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
}
func find(_ element: AXUIElement, depth: Int = 0, predicate: (AXUIElement) -> Bool) -> AXUIElement? {
    if predicate(element) { return element }
    if depth >= 12 { return nil }
    for child in children(element) {
        if let match = find(child, depth: depth + 1, predicate: predicate) { return match }
    }
    return nil
}
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
func bounds(_ element: AXUIElement) -> CGRect? {
    var position = CGPoint.zero, size = CGSize.zero
    guard let rawPosition = attribute(element, kAXPositionAttribute), let rawSize = attribute(element, kAXSizeAttribute),
          AXValueGetValue(rawPosition as! AXValue, .cgPoint, &position),
          AXValueGetValue(rawSize as! AXValue, .cgSize, &size), size.width > 0, size.height > 0 else { return nil }
    return CGRect(origin: position, size: size)
}
guard CommandLine.arguments.count >= 3, let pid = Int32(CommandLine.arguments[1]), pid > 0,
      let application = NSRunningApplication(processIdentifier: pid) else { fail("Exact test Chrome PID required") }
let app = AXUIElementCreateApplication(pid)
func sheet() -> AXUIElement {
    guard let value = find(app, predicate: { attribute($0, kAXRoleAttribute) as? String == kAXSheetRole }) else { fail("Chrome folder picker is not accessible") }
    return value
}
application.activate()
Thread.sleep(forTimeInterval: 0.3)
_ = sheet()
for down in [true, false] {
    let event = CGEvent(keyboardEventSource: nil, virtualKey: 4, keyDown: down)!
    event.flags = [.maskCommand, .maskShift]
    event.postToPid(pid)
}
Thread.sleep(forTimeInterval: 0.5)
for folder in CommandLine.arguments.dropFirst(2) {
    let picker = sheet()
    guard let text = find(picker, predicate: {
        attribute($0, kAXValueAttribute) as? String == folder || attribute($0, kAXTitleAttribute) as? String == folder
    }) else { fail("Visible installation folder not found: " + folder) }
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { fail("Test Chrome lost foreground before folder selection") }
    guard let target = bounds(text), let frame = bounds(picker) else { fail("Folder has no clickable bounds") }
    let point = CGPoint(x: target.midX, y: target.midY)
    guard frame.contains(point) else { fail("Folder is outside the test picker") }
    for click in 1...2 {
        for kind in [CGEventType.leftMouseDown, .leftMouseUp] {
            let event = CGEvent(mouseEventSource: nil, mouseType: kind, mouseCursorPosition: point, mouseButton: .left)!
            event.setIntegerValueField(.mouseEventClickState, value: Int64(click))
            event.post(tap: .cghidEventTap)
        }
    }
    Thread.sleep(forTimeInterval: 0.5)
}
let picker = sheet()
guard let controls = children(picker).first(where: { attribute($0, kAXRoleAttribute) as? String == kAXSplitGroupRole }) else { fail("Missing picker controls") }
let buttons = children(controls).filter { attribute($0, kAXRoleAttribute) as? String == kAXButtonRole }
guard buttons.count == 2, AXUIElementPerformAction(buttons[1], kAXPressAction as CFString) == .success else { fail("Folder selection could not be confirmed") }
