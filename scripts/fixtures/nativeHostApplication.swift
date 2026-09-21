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
    var secondary: NSWindow?
    var cancelNextClose = false
    var cancelledCloses = 0
    var quitRequests = 0
    var menuClicks = 0
    var clicks = 0
    var animation: Timer?
    var replacing = false
    var reopens = 0
    var events: [[String: Any]] = []
    let receipt = Bundle.main.bundleURL.appendingPathComponent("receipt.json").path
    func makeWindow() {
        window = NSWindow(contentRect: NSRect(x: 120, y: 120, width: 720, height: 480), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
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
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let delay = Bundle.main.object(forInfoDictionaryKey: "RedevenFixtureInitialWindowDelay") as? Double ?? 0
        if Bundle.main.object(forInfoDictionaryKey: "RedevenFixtureWindowOnReopen") as? Bool != true && Bundle.main.object(forInfoDictionaryKey: "RedevenFixtureWindowOnMenu") as? Bool != true {
            if delay > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + delay) { self.makeWindow(); self.save() } }
            else { makeWindow() }
        }
        let menu = NSMenu()
        let root = NSMenuItem(title: "Fixture", action: nil, keyEquivalent: "")
        let actions = NSMenu(title: "Fixture")
        let open = NSMenuItem(title: "Open fixture window", action: #selector(openWindow), keyEquivalent: "")
        open.target = self; actions.addItem(open)
        let action = NSMenuItem(title: "Record menu action", action: #selector(recordMenu), keyEquivalent: "")
        action.target = self; actions.addItem(action)
        let replace = NSMenuItem(title: "Replace window", action: #selector(replaceWindow), keyEquivalent: "")
        replace.target = self; actions.addItem(replace); root.submenu = actions
        let animate = NSMenuItem(title: "Toggle animation", action: #selector(toggleAnimation), keyEquivalent: "")
        animate.target = self; actions.addItem(animate)
        for (title, selector) in [("Open second window", #selector(openSecond)), ("Open utility panel", #selector(openUtility)), ("Minimize main window", #selector(minimizeMain)), ("Hide fixture", #selector(hideFixture)), ("Cancel next close", #selector(cancelClose))] {
            let item = NSMenuItem(title: title, action: selector, keyEquivalent: "")
            item.target = self; actions.addItem(item)
        }
        let quit = NSMenuItem(title: "Quit fixture", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.target = NSApp; actions.addItem(quit)
        menu.addItem(root)
        let edit = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        edit.submenu = NSMenu(title: "Edit")
        edit.submenu!.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        menu.addItem(edit); NSApp.mainMenu = menu
        if let delay = Bundle.main.object(forInfoDictionaryKey: "RedevenFixtureCloseDelay") as? Double {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { self.window?.close() }
        }
        if let delay = Bundle.main.object(forInfoDictionaryKey: "RedevenFixtureQuitDelay") as? Double {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { NSApp.terminate(nil) }
        }
        save()
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        reopens += 1
        if !flag && Bundle.main.object(forInfoDictionaryKey: "RedevenFixtureWindowOnReopen") as? Bool == true { makeWindow() }
        save()
        return true
    }
    @objc func openSecond() {
        let second = NSWindow(contentRect: NSRect(x: 250, y: 250, width: 420, height: 260), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        second.isReleasedWhenClosed = false; second.title = "Secondary fixture window"; second.delegate = self
        secondary = second; second.makeKeyAndOrderFront(nil); save()
    }
    @objc func openUtility() {
        let panel = NSPanel(contentRect: NSRect(x: 250, y: 250, width: 420, height: 260), styleMask: [.titled, .closable, .utilityWindow], backing: .buffered, defer: false)
        panel.level = .floating
        panel.isReleasedWhenClosed = false; panel.title = "Fixture utility panel"; panel.delegate = self
        secondary = panel; panel.makeKeyAndOrderFront(nil); save()
    }
    @objc func minimizeMain() { window.miniaturize(nil); save() }
    @objc func hideFixture() { NSApp.hide(nil); save() }
    @objc func cancelClose() { cancelNextClose = true; save() }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        quitRequests += 1; save()
        if Bundle.main.object(forInfoDictionaryKey: "RedevenFixtureCancelFirstQuit") as? Bool == true && quitRequests == 1 { return .terminateCancel }
        return .terminateNow
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if cancelNextClose { cancelNextClose = false; cancelledCloses += 1; save(); return false }
        return true
    }
    func windowDidMiniaturize(_ notification: Notification) { save() }
    func windowDidDeminiaturize(_ notification: Notification) { save() }
    func applicationDidHide(_ notification: Notification) { save() }
    func applicationDidUnhide(_ notification: Notification) { save() }
    @objc func openWindow() { if window == nil { makeWindow(); save() } }
    @objc func replaceWindow() {
        let text = field.stringValue
        replacing = true
        window.close()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            self.makeWindow()
            self.field.stringValue = text
            self.replacing = false
            self.save()
        }
    }
    @objc func toggleAnimation() {
        if let animation { animation.invalidate(); self.animation = nil; return }
        window.makeFirstResponder(nil)
        animation = Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { _ in
            let hue = ProcessInfo.processInfo.systemUptime.truncatingRemainder(dividingBy: 3) / 3
            self.window.backgroundColor = NSColor(hue: hue, saturation: 0.6, brightness: 0.7, alpha: 1)
        }
    }
    @objc func recordMenu() { menuClicks += 1; save() }
    @objc func click() { clicks += 1; save() }
    @objc func save() {
        let value: [String: Any] = ["menu_clicks": menuClicks, "events": events, "pid": ProcessInfo.processInfo.processIdentifier, "clicks": clicks, "text": field?.stringValue ?? "", "window": window?.windowNumber ?? 0, "width": window?.frame.width ?? 0, "height": window?.frame.height ?? 0, "reopens": reopens, "secondary": secondary?.windowNumber ?? 0, "minimized": window?.isMiniaturized ?? false, "hidden": NSApp.isHidden, "cancelled_closes": cancelledCloses, "quit_requests": quitRequests]
        try! JSONSerialization.data(withJSONObject: value).write(to: URL(fileURLWithPath: receipt), options: .atomic)
    }
    func windowDidResize(_ notification: Notification) { if field != nil { save() } }
    func windowWillClose(_ notification: Notification) {
        if let closed = notification.object as? NSWindow, closed === secondary { secondary = nil; window.makeKeyAndOrderFront(nil); save(); return }
        save(); if !replacing && Bundle.main.object(forInfoDictionaryKey: "RedevenFixtureKeepRunning") as? Bool != true { DispatchQueue.main.async { NSApp.terminate(nil) } } }
}
let app = FixtureApplication.shared
app.setActivationPolicy(.regular)
let delegate = Fixture()
app.delegate = delegate
app.run()
