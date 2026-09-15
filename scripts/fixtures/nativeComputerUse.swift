import AppKit
import Foundation

// A real native application with observable effects, used only by the Desktop
// qualification. It never sends messages or modifies user files.
final class FixtureState {
    let resultPath: String
    var clicks = 0
    var doubleClicked = false
    var entered = false
    var scrolled = false
    var scrollOffset = 0.0
    var wheelEvents = 0
    var wheelDelta = 0.0
    var geometry: [String: Double] = [:]
    var actions: [[String: Any]] = []
    var onChange: (() -> Void)?
    init(_ path: String) { resultPath = path }
    // Each qualification turn checks its exact requested click count separately.
    var complete: Bool { clicks >= 2 && doubleClicked && entered && scrolled }
    func record(_ action: String) {
        var entry: [String: Any] = ["action": action, "clicks": clicks,
                                   "timestamp_ms": Date().timeIntervalSince1970 * 1000]
        if let event = NSApp.currentEvent {
            entry["event_type"] = event.type.rawValue
            entry["window_x"] = event.locationInWindow.x
            entry["window_y"] = event.locationInWindow.y
        }
        actions.append(entry)
        if actions.count > 64 { actions.removeFirst(actions.count - 64) }
    }
    func save() {
        let result: [String: Any] = ["clicks": clicks, "doubleClicked": doubleClicked,
            "entered": entered, "scrolled": scrolled, "scrollOffset": scrollOffset,
            "wheelEvents": wheelEvents, "wheelDelta": wheelDelta, "complete": complete, "geometry": geometry, "actions": actions]
        if let bytes = try? JSONSerialization.data(withJSONObject: result) {
            try? bytes.write(to: URL(fileURLWithPath: resultPath), options: .atomic)
        }
        onChange?()
    }
}

final class DoubleClickArea: NSView {
    let state: FixtureState
    init(state: FixtureState, frame: NSRect) {
        self.state = state
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.systemBlue.withAlphaComponent(0.2).cgColor
    }
    required init?(coder: NSCoder) { fatalError("Not used by the fixture") }
    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 { state.doubleClicked = true; state.record("double_click"); state.save() }
    }
}

final class ScrollDocument: NSView {
    override var isFlipped: Bool { true }
}

final class Delegate: NSObject, NSApplicationDelegate {
    let state: FixtureState
    var window: NSWindow!
    var status: NSTextField!
    var input: NSTextField!
    var wheelMonitor: Any?
    init(path: String) { state = FixtureState(path) }
    func label(_ text: String, _ frame: NSRect) -> NSTextField {
        let view = NSTextField(labelWithString: text)
        view.frame = frame
        view.font = NSFont.systemFont(ofSize: 19)
        return view
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let screen = NSScreen.screens.first else { NSApp.terminate(nil); return }
        window = NSWindow(contentRect: NSRect(x: 30, y: screen.frame.maxY - 650, width: 720, height: 550),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Flower Native Fixture"
        window.level = .floating
        window.backgroundColor = NSColor(calibratedRed: 0.93, green: 0.95, blue: 0.99, alpha: 1)
        let content = window.contentView!
        content.addSubview(label("Flower Native Fixture", NSRect(x: 25, y: 485, width: 650, height: 35)))
        let button = NSButton(title: "Complete native step", target: self, action: #selector(click))
        button.frame = NSRect(x: 25, y: 415, width: 310, height: 50)
        button.font = NSFont.systemFont(ofSize: 20)
        content.addSubview(button)
        let double = DoubleClickArea(state: state, frame: NSRect(x: 365, y: 415, width: 320, height: 50))
        let doubleLabel = label("Double click this blue area", NSRect(x: 15, y: 12, width: 295, height: 30))
        double.addSubview(doubleLabel)
        content.addSubview(double)
        content.addSubview(label("Enter Flower, then press Enter:", NSRect(x: 25, y: 360, width: 600, height: 30)))
        input = NSTextField(frame: NSRect(x: 25, y: 310, width: 650, height: 40))
        input.font = NSFont.systemFont(ofSize: 20)
        input.target = self; input.action = #selector(enter)
        content.addSubview(input)
        content.addSubview(label("Scroll inside the area below:", NSRect(x: 25, y: 260, width: 600, height: 30)))
        let scroll = NSScrollView(frame: NSRect(x: 25, y: 100, width: 650, height: 150))
        scroll.hasVerticalScroller = true
        let document = ScrollDocument(frame: NSRect(x: 0, y: 0, width: 630, height: 1000))
        document.addSubview(label("Scroll area: top", NSRect(x: 20, y: 20, width: 400, height: 35)))
        document.addSubview(label("Scrolled content", NSRect(x: 20, y: 400, width: 400, height: 35)))
        scroll.documentView = document
        scroll.contentView.postsBoundsChangedNotifications = true
        NotificationCenter.default.addObserver(forName: NSView.boundsDidChangeNotification, object: scroll.contentView, queue: .main) { [weak self, weak scroll] _ in
            guard let self, let scroll else { return }
            self.state.scrollOffset = scroll.contentView.bounds.origin.y
            if self.state.scrollOffset > 0 { self.state.scrolled = true }
            self.state.save()
        }
        content.addSubview(scroll)
        status = label("Ready", NSRect(x: 25, y: 25, width: 650, height: 60))
        status.maximumNumberOfLines = 2
        content.addSubview(status)
        state.onChange = { [weak self] in
            guard let self else { return }
            self.status.stringValue = "Clicks: \(self.state.clicks) · Double click: \(self.state.doubleClicked) · Entered: \(self.state.entered) · Scrolled: \(self.state.scrolled)"
            if self.state.complete { self.window.backgroundColor = NSColor(calibratedRed: 0.84, green: 0.96, blue: 0.9, alpha: 1) }
        }
        let frame = window.frame
        state.geometry = ["x": frame.minX, "y": screen.frame.maxY - frame.maxY, "width": frame.width, "height": frame.height,
            "displayWidth": screen.frame.width, "displayHeight": screen.frame.height]
        for (name, view) in [("click", button as NSView), ("double", double), ("input", input!), ("scroll", scroll)] {
            let bounds = window.convertToScreen(view.convert(view.bounds, to: nil))
            state.geometry[name + "X"] = bounds.midX
            state.geometry[name + "Y"] = screen.frame.maxY - bounds.midY
        }
        state.save()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        wheelMonitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
            self?.state.wheelEvents += 1
            self?.state.wheelDelta = event.scrollingDeltaY
            self?.state.save()
            return event
        }
        // Keep the physical pointer away from the scroll area so the fixture
        // catches helpers that post clicks without moving the actual cursor.
        if CommandLine.arguments.contains("--park-pointer") {
            CGWarpMouseCursorPosition(CGPoint(x: frame.minX + 30, y: screen.frame.maxY - frame.maxY + 50))
        }
    }
    @objc func click() { state.clicks += 1; state.record("click"); state.save() }
    @objc func enter() { state.entered = input.stringValue == "Flower"; state.record("enter"); state.save() }
}

let app = NSApplication.shared
// The fixture uses fixed pale backgrounds; fix its appearance as well so
// system dark mode cannot produce white labels on those backgrounds.
app.appearance = NSAppearance(named: .aqua)
app.setActivationPolicy(.regular)
guard CommandLine.arguments.count >= 2 else { exit(2) }
let delegate = Delegate(path: CommandLine.arguments[1])
app.delegate = delegate
app.run()
