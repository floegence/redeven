import AppKit

final class EntryDragPad: NSView {
    var record: ((NSEvent) -> Void)?
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { record?(event) }
    override func mouseDragged(with event: NSEvent) { record?(event) }
    override func mouseUp(with event: NSEvent) { record?(event) }
}

// Task-owned application for real launch/discovery and model acceptance.
final class EntryDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var field: NSTextField!
    var status: NSTextField!
    var clicks = 0
    var dragEvents: [[String: Any]] = []
    var second: NSWindow?
    let path = Bundle.main.object(forInfoDictionaryKey: "FixtureResultPath") as! String
    func save() {
        let facts: [String: Any] = ["pid": ProcessInfo.processInfo.processIdentifier, "clicks": clicks, "value": field?.stringValue ?? "", "drag_events": dragEvents]
        try? JSONSerialization.data(withJSONObject: facts).write(to: URL(fileURLWithPath: path), options: .atomic)
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let mode = Bundle.main.object(forInfoDictionaryKey: "FixtureMode") as? String
        if mode == "no_window" { save(); return }
        window = NSWindow(contentRect: NSRect(x: 150, y: 150, width: 480, height: 220), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Computer Entry Acceptance"
        window.animationBehavior = .none
        if mode == "drag" || mode == "focus_change" {
            let pad = EntryDragPad(frame: window.contentView!.bounds)
            pad.wantsLayer = true; pad.layer?.backgroundColor = NSColor.systemTeal.withAlphaComponent(0.15).cgColor
            pad.setAccessibilityElement(true); pad.setAccessibilityRole(.group); pad.setAccessibilityLabel("Drag pad")
            window.contentView!.addSubview(pad)
            let label = NSTextField(labelWithString: "Drag once from (50,100) to (300,150), holding for 1000 ms. Coordinates are window-local, top-left origin.")
            label.frame = NSRect(x: 15, y: 165, width: 450, height: 50)
            label.maximumNumberOfLines = 3; window.contentView!.addSubview(label)
            status = NSTextField(labelWithString: "No pointer events")
            status.setAccessibilityLabel("Pointer telemetry")
            status.frame = NSRect(x: 15, y: 10, width: 450, height: 50)
            status.maximumNumberOfLines = 3; window.contentView!.addSubview(status)
            pad.record = { [weak self] event in
                guard let self else { return }
                let point = self.window.convertPoint(toScreen: event.locationInWindow)
                self.dragEvents.append(["type": event.type == .leftMouseDown ? "down" : event.type == .leftMouseUp ? "up" : "drag",
                    "time_ms": ProcessInfo.processInfo.systemUptime * 1000, "event_time_ms": event.timestamp * 1000,
                    "source_pid": event.cgEvent.map { $0.getIntegerValueField(.eventSourceUnixProcessID) } as Any? ?? NSNull(),
                    "source_marker": event.cgEvent.map { $0.getIntegerValueField(.eventSourceUserData) } as Any? ?? NSNull(),
                    "x": point.x - self.window.frame.minX, "y": self.window.frame.maxY - point.y])
                let down = self.dragEvents.first { $0["type"] as? String == "down" }
                if event.type == .leftMouseUp, let down {
                    let held = ProcessInfo.processInfo.systemUptime * 1000 - (down["time_ms"] as! Double)
                    self.status.stringValue = "Released after \(Int(held)) ms; \(self.dragEvents.count) pointer events"
                }
                self.save()
                if mode == "focus_change" && event.type == .leftMouseDown {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        self.second = NSWindow(contentRect: NSRect(x: 670, y: 150, width: 320, height: 220), styleMask: [.titled, .closable], backing: .buffered, defer: false)
                        self.second!.title = "Programmatic focus change"
                        self.second!.makeKeyAndOrderFront(nil)
                        self.save()
                    }
                }
            }
            window.makeKeyAndOrderFront(nil); save(); return
        }
        let label = NSTextField(labelWithString: "Enter the acceptance code, then Confirm.")
        label.frame = NSRect(x: 20, y: 165, width: 440, height: 25); window.contentView!.addSubview(label)
        field = NSTextField(frame: NSRect(x: 20, y: 115, width: 440, height: 30))
        field.setAccessibilityLabel("Acceptance code"); window.contentView!.addSubview(field)
        let button = NSButton(title: "Confirm", target: self, action: #selector(confirm))
        button.frame = NSRect(x: 20, y: 60, width: 120, height: 35); window.contentView!.addSubview(button)
        status = NSTextField(labelWithString: "Awaiting confirmation"); status.setAccessibilityLabel("Result")
        status.frame = NSRect(x: 160, y: 60, width: 300, height: 35); window.contentView!.addSubview(status)
        window.makeKeyAndOrderFront(nil); save()
        if mode == "multiple" {
            second = NSWindow(contentRect: NSRect(x: 670,y:150,width:320,height:220),styleMask:[.titled,.closable],backing:.buffered,defer:false)
            second!.title = "Second Entry Window"; second!.makeKeyAndOrderFront(nil)
        }
        if mode == "minimized" { window.miniaturize(nil) }
    }
    @objc func confirm() { clicks += 1; status.stringValue = "Confirmed: " + field.stringValue; save() }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = EntryDelegate(); app.delegate = delegate; app.run()
