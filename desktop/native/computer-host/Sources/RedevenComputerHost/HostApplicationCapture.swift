import CoreVideo
import FloeNativeDesktop

// Application viewers expose only their existing picture preferences. Desktop
// audio, native pixels and pipeline capacity cannot be enabled by app packets.
struct HostApplicationCaptureSettings: Equatable {
    let native: NativeCaptureSettings
    var mode: String { native.mode }
    var pixelRatio: Double { native.pixelRatio }
    var maxDimension: Int { native.maxDimension }
    var frameRate: Int { native.frameRate }
    var video: Bool { native.video }
    init(request: [String: Any] = [:]) throws {
        var settings: [String: Any] = [:]
        for key in ["mode", "pixel_ratio", "max_dimension", "frame_rate", "video"] { settings[key] = request[key] }
        native = try NativeCaptureSettings(request: settings)
    }
    func dimensions(points: CGSize, sourceScale: Double) -> CGSize { native.dimensions(points: points, sourceScale: sourceScale) }
}
typealias HostApplicationStream = NativeCaptureStream
func hostApplicationPixelsEqual(_ lhs: CVPixelBuffer, _ rhs: CVPixelBuffer) -> Bool { nativeCapturePixelsEqual(lhs, rhs) }
