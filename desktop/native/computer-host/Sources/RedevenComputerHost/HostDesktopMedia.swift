import Foundation

// Desktop media never waits behind the shared helper's control JSON stream.
// Native capture credits bound video; the delivery queue bounds audio as well.
enum HostDesktopMedia {
    private static let queue = DispatchQueue(label: "redeven.desktop.media", qos: .userInteractive)
    private static let lock = NSLock()
    private static var pending = 0

    static func emit(_ value: [String: Any]) -> Bool {
        guard let descriptor = ProcessInfo.processInfo.environment["REDEVEN_HOST_MEDIA_FD"].flatMap(Int32.init),
              let encoded = value["data"] as? String, let payload = Data(base64Encoded: encoded) else { return false }
        lock.lock()
        let admitted = pending < 32
        if admitted { pending += 1 }
        lock.unlock()
        // Never discard dependent encoded video and continue its chain.
        guard admitted else { return false }
        queue.async {
            defer { lock.lock(); pending -= 1; lock.unlock() }
            var header = value
            header.removeValue(forKey: "data")
            header["bytes"] = payload.count
            guard let json = try? JSONSerialization.data(withJSONObject: header) else { Darwin._exit(3) }
            var length = UInt32(json.count).bigEndian
            let prefix = withUnsafeBytes(of: &length) { Data($0) }
            for data in [prefix, json, payload] {
                let succeeded = data.withUnsafeBytes { bytes -> Bool in
                    var offset = 0
                    while offset < bytes.count {
                        let count = Darwin.write(descriptor, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                        if count < 0 && errno == EINTR { continue }
                        guard count > 0 else { return false }
                        offset += count
                    }
                    return true
                }
                if !succeeded { Darwin._exit(3) }
            }
        }
        return true
    }
}
