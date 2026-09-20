import AppKit
import Foundation

// Only this disposable fixture's windows and scratch receipt are manipulated.
final class FixtureApplication: NSApplication {
    override func sendEvent(_ event: NSEvent) {
        super.sendEvent(event)
        if [.leftMouseDown, .leftMouseUp, .keyDown, .keyUp].contains(event.type), let fixture = delegate as? Fixture {
            fixture.events.append(["flags": event.modifierFlags.rawValue, "window": event.windowNumber, "type": event.type.rawValue, "x": event.locationInWindow.x, "y": event.locationInWindow.y, "active": isActive, "key": fixture.window?.isKeyWindow == true])
            fixture.save()
        }
    }
}
final class Fixture: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow!
    var field: NSTextField!
    var menuClicks = 0
    var clicks = 0
    var events: [[String: Any]] = []
    let receipt = Bundle.main.bundleURL.appendingPathComponent("receipt.json").path
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 120, y: 120, width: 720, height: 480), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Redeven native application fixture"
        window.delegate = self
        window.backgroundColor = NSColor(srgbRed: 0.15, green: 0.45, blue: 0.7, alpha: 1)
        let button = NSButton(title: "Record click", target: self, action: #selector(click))
        button.frame = NSRect(x: 30, y: 300, width: 160, height: 40)
        window.contentView!.addSubview(button)
        field = NSTextField(frame: NSRect(x: 30, y: 220, width: 450, height: 40))
        field.placeholderString = "Type here"
        field.target = self; field.action = #selector(save)
        window.contentView!.addSubview(field)
        window.makeKeyAndOrderFront(nil)
        let menu = NSMenu()
        let root = NSMenuItem(title: "Fixture", action: nil, keyEquivalent: "")
        let actions = NSMenu(title: "Fixture")
        let action = NSMenuItem(title: "Record menu action", action: #selector(recordMenu), keyEquivalent: "")
        action.target = self; actions.addItem(action); root.submenu = actions
        menu.addItem(root)
        let edit = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        edit.submenu = NSMenu(title: "Edit")
        edit.submenu!.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        menu.addItem(edit); NSApp.mainMenu = menu
        save()
    }
    @objc func recordMenu() { menuClicks += 1; save() }
    @objc func click() { clicks += 1; save() }
    @objc func save() {
        let value: [String: Any] = ["menu_clicks": menuClicks, "events": events, "pid": ProcessInfo.processInfo.processIdentifier, "clicks": clicks, "text": field.stringValue, "window": window.windowNumber, "width": window.frame.width, "height": window.frame.height]
        try! JSONSerialization.data(withJSONObject: value).write(to: URL(fileURLWithPath: receipt), options: .atomic)
    }
    func windowDidResize(_ notification: Notification) { if field != nil { save() } }
    func windowWillClose(_ notification: Notification) { save(); DispatchQueue.main.async { NSApp.terminate(nil) } }
}
let app = FixtureApplication.shared
app.setActivationPolicy(.regular)
let delegate = Fixture()
app.delegate = delegate
app.run()
