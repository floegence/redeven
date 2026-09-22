import Foundation

// One AppKit/ScreenCaptureKit process owns all human-operated application
// sessions. A suspended stream must not leave a second process competing for
// the same replayd application identity. Each channel retains its own binding,
// generation, held input, capture credit and independent end operation.
final class HostApplicationHost {
    private var sessions: [String: HostApplicationSession] = [:]
    private var ending = false
    private let output: ([String: Any]) -> Void

    init(output: @escaping ([String: Any]) -> Void = emit) { self.output = output }

    func handle(_ request: [String: Any]) {
        guard !ending,
              let id = request["session_id"] as? String, id.count == 32,
              id.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else { return }
        guard request["protocol_version"] as? Int == 2 else {
            output(["session_id": id, "type": "error", "code": "UNSUPPORTED_PROTOCOL"])
            return
        }
        if request["action"] as? String == "detach" {
            sessions[id]?.end()
            return
        }
        if sessions[id] == nil {
            sessions[id] = HostApplicationSession { [weak self] message in
                var envelope = message
                envelope["session_id"] = id
                self?.output(envelope)
                if message["type"] as? String == "ended" {
                    // Encoder output uses its capture queue; session ownership
                    // and cleanup always remain on the main run loop.
                    DispatchQueue.main.async { self?.sessions.removeValue(forKey: id) }
                }
            }
        }
        sessions[id]?.handle(request)
    }

    func end(completion: @escaping () -> Void) {
        ending = true
        let group = DispatchGroup()
        for session in Array(sessions.values) {
            group.enter()
            session.end { group.leave() }
        }
        group.notify(queue: .main, execute: completion)
    }
}
