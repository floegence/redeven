import AppKit
import Foundation

// This fixture only orders its own windows at the back of the window stack.
// It never activates an application or sends system input.
func emit(_ result: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: result)
    print(String(data: data, encoding: .utf8)!); fflush(stdout)
}

if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--preflight" {
    guard let session = CGSessionCopyCurrentDictionary() as? [String: Any],
          (session[kCGSessionOnConsoleKey as String] as? Bool) == true,
          (session["CGSSessionScreenIsLocked"] as? Bool) != true else {
        emit(["error": "SCREEN_LOCKED_OR_UNAVAILABLE", "message": "Unlock the macOS console before background window qualification."])
        exit(2)
    }
    exit(0)
}

if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--inspect" {
    let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
    guard let image = NSBitmapImageRep(data: data), image.bitsPerSample == 8,
          image.samplesPerPixel >= 3, image.samplesPerPixel <= 4 else { exit(2) }
    // The helper emits sRGB PNG samples. NSBitmapImageRep.colorAt produces a
    // calibrated NSColor; converting it again would change these raw samples.
    var pixel = [Int](repeating: 0, count: image.samplesPerPixel)
    image.getPixel(&pixel, atX: image.pixelsWide / 2, y: image.pixelsHigh / 2)
    emit(["width": image.pixelsWide, "height": image.pixelsHigh,
          "center_rgb": pixel.prefix(3).map { Double($0) / 255 }])
    exit(0)
}

final class Delegate: NSObject, NSApplicationDelegate {
    var target: NSWindow!
    var cover: NSWindow!
    let initialApplication = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
    let initialPointer = CGEvent(source: nil)?.location ?? .zero

    func applicationDidFinishLaunching(_ notification: Notification) {
        target = NSWindow(contentRect: NSRect(x: 60, y: 80, width: 480, height: 320),
                          styleMask: [.titled, .closable], backing: .buffered, defer: false)
        target.title = "Flower Background Capture"
        target.backgroundColor = NSColor(srgbRed: 0.2, green: 0.6, blue: 0.3, alpha: 1)
        target.contentView!.wantsLayer = true
        target.contentView!.layer!.backgroundColor = NSColor(srgbRed: 0.2, green: 0.6, blue: 0.3, alpha: 1).cgColor
        let label = NSTextField(labelWithString: "Background target content")
        label.frame = NSRect(x: 20, y: 20, width: 400, height: 30)
        target.contentView!.addSubview(label)
        target.orderBack(nil)
        cover = NSWindow(contentRect: target.frame.insetBy(dx: -15, dy: -15),
                         styleMask: [.borderless], backing: .buffered, defer: false)
        cover.title = "Flower Capture Cover"
        cover.backgroundColor = NSColor(srgbRed: 0.9, green: 0.1, blue: 0.1, alpha: 1)
        cover.order(.above, relativeTo: target.windowNumber)
        DispatchQueue.main.async { self.report() }
        // The driver requests another state snapshot over stdin. These are
        // fixture observations, never commands to the helper or the desktop.
        DispatchQueue.global().async {
            while let command = readLine() {
                guard command == "status" else { exit(2) }
                DispatchQueue.main.async { self.report() }
            }
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }

    func report() {
        let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
        let ids = windows.compactMap { ($0[kCGWindowNumber as String] as? NSNumber)?.intValue }
        let targetIndex = ids.firstIndex(of: target.windowNumber)
        let coverIndex = ids.firstIndex(of: cover.windowNumber)
        let pointer = CGEvent(source: nil)?.location ?? .zero
        emit(["target_window": target.windowNumber, "cover_window": cover.windowNumber,
              "target_width": Int(target.frame.width), "target_height": Int(target.frame.height),
              "covered": targetIndex != nil && coverIndex != nil && coverIndex! < targetIndex! && cover.frame.contains(target.frame),
              "frontmost_unchanged": (NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0) == initialApplication,
              "pointer_unchanged": pointer == initialPointer,
              "initial_pointer": [initialPointer.x, initialPointer.y], "pointer": [pointer.x, pointer.y]])
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = Delegate()
app.delegate = delegate
app.run()
