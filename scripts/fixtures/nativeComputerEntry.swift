import AppKit

// Task-owned application for real launch/discovery and model acceptance.
final class EntryDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var field: NSTextField!
    var status: NSTextField!
    var clicks = 0
    var second: NSWindow?
    let path = Bundle.main.object(forInfoDictionaryKey: "FixtureResultPath") as! String
    func save() {
        let facts: [String: Any] = ["pid": ProcessInfo.processInfo.processIdentifier, "clicks": clicks, "value": field?.stringValue ?? ""]
        try? JSONSerialization.data(withJSONObject: facts).write(to: URL(fileURLWithPath: path), options: .atomic)
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let mode = Bundle.main.object(forInfoDictionaryKey: "FixtureMode") as? String
        if mode == "no_window" { save(); return }
        window = NSWindow(contentRect: NSRect(x: 150, y: 150, width: 480, height: 220), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Computer Entry Acceptance"
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
