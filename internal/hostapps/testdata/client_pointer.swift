import AppKit

// Task-owned AppKit controls; receipts report actual control state after events.
final class FlippedView: NSView { override var isFlipped: Bool { true } }
final class PointerApplication: NSApplication {
    override func sendEvent(_ event: NSEvent) {
        super.sendEvent(event)
        guard let owner = delegate as? PointerFixture else { return }
        if event.type == .leftMouseUp || event.type == .rightMouseUp { owner.releases += 1; owner.save() }
        if event.type == .scrollWheel {
            owner.wheels.append(["dx": event.scrollingDeltaX, "dy": event.scrollingDeltaY, "inverted": event.isDirectionInvertedFromDevice, "precise": event.hasPreciseScrollingDeltas])
            owner.wheels = Array(owner.wheels.suffix(16)); owner.save()
        }
        if event.type == .rightMouseDown { owner.rights += 1; owner.save() }
    }
}
final class PointerFixture: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    let outer = NSScrollView(), inner = NSScrollView()
    let drag = NSSlider(value: 20, minValue: 0, maxValue: 100, target: nil, action: nil)
    var clicks = 0, doubles = 0, rights = 0, releases = 0
    var wheels: [[String: Any]] = []
    @objc func click() {
        clicks += 1
        if NSApp.currentEvent?.clickCount == 2 { doubles += 1 }
        save()
    }
    @objc func save() {
        guard window != nil else { return }
        let state: [String: Any] = ["releases": releases, "wheels": wheels, "clicks": clicks, "doubles": doubles, "rights": rights, "drag": drag.doubleValue,
            "outer": [outer.contentView.bounds.origin.x, outer.contentView.bounds.origin.y],
            "inner": [inner.contentView.bounds.origin.x, inner.contentView.bounds.origin.y],
            "inset": window.frame.height - window.contentView!.bounds.height,
            "width": window.frame.width, "height": window.frame.height, "pid": ProcessInfo.processInfo.processIdentifier]
        if let data = try? JSONSerialization.data(withJSONObject: state) {
            try? data.write(to: Bundle.main.bundleURL.appendingPathComponent("receipt.json"), options: .atomic)
        }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 800, height: 600),
            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.title = "Redeven pointer acceptance"
        let root = FlippedView(frame: NSRect(x: 0, y: 0, width: 800, height: 600))
        window.contentView = root
        outer.frame = root.bounds; outer.autoresizingMask = [.width, .height]
        inner.frame = NSRect(x: 340, y: 70, width: 240, height: 240)
        for scroll in [outer, inner] {
            scroll.hasVerticalScroller = true; scroll.hasHorizontalScroller = true
            scroll.usesPredominantAxisScrolling = false
            let content = FlippedView(frame: NSRect(x: 0, y: 0, width: 2000, height: 3000))
            content.wantsLayer = true; content.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
            scroll.documentView = content
            scroll.contentView.postsBoundsChangedNotifications = true
            NotificationCenter.default.addObserver(self, selector: #selector(save), name: NSView.boundsDidChangeNotification, object: scroll.contentView)
            root.addSubview(scroll)
        }
        let button = NSButton(title: "Tap target", target: self, action: #selector(click))
        button.frame = NSRect(x: 20, y: 220, width: 180, height: 60)
        outer.documentView!.addSubview(button)
        drag.frame = NSRect(x: 20, y: 100, width: 260, height: 50)
        drag.target = self; drag.action = #selector(save); drag.isContinuous = true
        outer.documentView!.addSubview(drag)
        let field = NSTextField(string: "Select this text")
        field.frame = NSRect(x: 20, y: 350, width: 260, height: 30)
        outer.documentView!.addSubview(field)
        for n in 0..<60 {
            let label = NSTextField(labelWithString: "Native nested row \(n)")
            label.frame = NSRect(x: 8, y: n * 40, width: 1200, height: 30)
            inner.documentView!.addSubview(label)
        }
        NotificationCenter.default.addObserver(self, selector: #selector(save), name: NSWindow.didResizeNotification, object: window)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        save()
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let application = PointerApplication.shared
let fixture = PointerFixture()
application.delegate = fixture
application.setActivationPolicy(.regular)
application.run()
