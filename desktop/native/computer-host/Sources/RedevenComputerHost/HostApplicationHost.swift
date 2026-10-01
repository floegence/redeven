import Foundation
import FloeNativeDesktop

// One AppKit/ScreenCaptureKit process owns all human-operated application
// sessions. A suspended stream must not leave a second process competing for
// the same replayd application identity. Each channel retains its own binding,
// generation, held input, capture credit and independent end operation.
final class HostApplicationHost {
    private var sessions: [String: HostApplicationSession] = [:]
    private var desktops: [String: NativeDesktopSession] = [:]
    private var controller: String?
    private var acquiring: String?
    private var ending = false
    private let output: ([String: Any]) -> Void

    init(output: @escaping ([String: Any]) -> Void = emit) { self.output = output }

    func handle(_ request: [String: Any]) {
        defer { acquiring = nil }
        guard !ending,
              let id = request["session_id"] as? String, id.count == 32,
              id.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else { return }
        guard request["protocol_version"] as? Int == 2 else {
            output(["session_id": id, "type": "error", "code": "UNSUPPORTED_PROTOCOL"])
            return
        }
        if request["action"] as? String == "detach" {
            if controller == id { controller = nil }
            desktops.removeValue(forKey: id)?.close()
            sessions[id]?.end()
            return
        }
        if request["action"] as? String == "desktop" {
            guard sessions[id] == nil, let command = request["command"] as? [String: Any] else { return }
            let method = command["method"] as? String
            if ["connect", "set_mode"].contains(method ?? ""), command["mode"] as? String == "control" {
                guard acquire(id, takeover: request["takeover"] as? Bool == true) else {
                    output(["session_id": id, "version": 1, "type": "error", "id": command["id"] ?? 0, "code": "CONTROL_IN_USE"])
                    return
                }
            } else if method == "disconnect" || method == "set_mode" && command["mode"] as? String == "view" {
                if controller == id { controller = nil }
            }
            if desktops[id] == nil {
                desktops[id] = NativeDesktopSession(mayControl: { [weak self] in self?.controller == id }) { [weak self] message in
                    var envelope = message
                    envelope["session_id"] = id
                    if ["frame", "audio"].contains(message["type"] as? String ?? "") {
                        if !HostDesktopMedia.emit(envelope) {
                            self?.desktops.removeValue(forKey: id)?.close()
                            self?.output(["session_id": id, "version": 1, "type": "error", "code": "MEDIA_BACKPRESSURE"])
                        }
                    } else {
                        if message["type"] as? String == "error", self?.acquiring == id, self?.controller == id {
                            self?.controller = nil
                        }
                        self?.output(envelope)
                    }
                }
            }
            desktops[id]?.handle(command)
            return
        }
        guard desktops[id] == nil else { return }
        if ["resume", "launch"].contains(request["action"] as? String ?? ""), request["defer_capture"] as? Bool != true {
            guard acquire(id, takeover: request["takeover"] as? Bool == true) else {
                output(["session_id": id, "type": "operation_error", "action": request["action"] ?? "", "code": "CONTROL_IN_USE"])
                return
            }
        }
        if request["action"] as? String == "suspend", controller == id { controller = nil }
        if sessions[id] == nil {
            sessions[id] = HostApplicationSession(mayControl: { [weak self] in self?.controller == id }) { [weak self] message in
                var envelope = message
                envelope["session_id"] = id
                if message["type"] as? String == "operation_error", self?.acquiring == id, self?.controller == id {
                    self?.controller = nil
                }
                if message["type"] as? String == "window" { envelope["control"] = self?.controller == id }
                self?.output(envelope)
                if message["type"] as? String == "ended" {
                    // Encoder output uses its capture queue; session ownership
                    // and cleanup always remain on the main run loop.
                    DispatchQueue.main.async {
                        if self?.controller == id { self?.controller = nil }
                        self?.sessions.removeValue(forKey: id)
                    }
                }
            }
        }
        sessions[id]?.handle(request)
    }

    private func acquire(_ id: String, takeover: Bool) -> Bool {
        if let previous = controller, previous != id {
            guard takeover else { return false }
            sessions[previous]?.revokeControl()
            desktops[previous]?.revokeControl()
        }
        if controller != id { acquiring = id }
        controller = id
        return true
    }

    func end(completion: @escaping () -> Void) {
        ending = true
        controller = nil
        let group = DispatchGroup()
        for desktop in desktops.values {
            group.enter()
            desktop.close { group.leave() }
        }
        for session in Array(sessions.values) {
            group.enter()
            session.end { group.leave() }
        }
        group.notify(queue: .main, execute: completion)
    }
}
