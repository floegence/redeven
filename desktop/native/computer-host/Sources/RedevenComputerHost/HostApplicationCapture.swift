import AppKit
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers
import VideoToolbox

struct HostApplicationCaptureSettings: Equatable {
    let mode: String
    let pixelRatio: Double
    let maxDimension: Int
    let frameRate: Int
    let video: Bool
    var imageQuality: Double { mode == "data" ? 0.72 : mode == "clarity" ? 0.95 : 0.88 }
    init(request: [String: Any] = [:]) throws {
        guard request["mode"] == nil || request["mode"] is String,
              request["video"] == nil || (request["video"] as? NSNumber).map({ CFGetTypeID($0) == CFBooleanGetTypeID() }) == true else {
            throw NativeInput.invalid("Invalid picture setting.")
        }
        mode = request["mode"] as? String ?? "auto"
        guard ["auto", "clarity", "smooth", "data"].contains(mode) else { throw NativeInput.invalid("Unknown picture mode.") }
        func number(_ name: String, fallback: Double, allowed: ClosedRange<Double>) throws -> Double {
            guard let raw = request[name] else { return fallback }
            guard let value = raw as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite,
                  allowed.contains(value.doubleValue) else { throw NativeInput.invalid("Invalid picture setting.") }
            return value.doubleValue
        }
        pixelRatio = try number("pixel_ratio", fallback: 2, allowed: 0.5...4)
        let dimension = try number("max_dimension", fallback: 0, allowed: 0...4096)
        let fps = try number("frame_rate", fallback: 0, allowed: 0...60)
        guard [0, 1600, 1920, 2560, 3840, 4096].contains(dimension), [0, 15, 24, 30, 60].contains(fps) else { throw NativeInput.invalid("Unsupported picture limit.") }
        maxDimension = Int(dimension == 0 ? (mode == "data" ? 1600 : mode == "smooth" ? 2560 : 4096) : dimension)
        frameRate = Int(fps == 0 ? (mode == "smooth" ? 60 : mode == "data" ? 15 : 30) : fps)
        video = request["video"] as? Bool ?? false
    }
    func dimensions(points: CGSize, sourceScale: Double) -> CGSize {
        let scale = min(pixelRatio, sourceScale, Double(maxDimension) / max(points.width, points.height))
        // Even dimensions are required by the H.264 4:2:0 encoder.
        return CGSize(width: max(2, Int(points.width * scale) / 2 * 2), height: max(2, Int(points.height * scale) / 2 * 2))
    }
}

// ScreenCaptureKit can deliver complete samples even when the pixels have not
// changed. Compare active BGRA rows (excluding padding) before encoding them.
func hostApplicationPixelsEqual(_ lhs: CVPixelBuffer, _ rhs: CVPixelBuffer) -> Bool {
    guard CVPixelBufferGetWidth(lhs) == CVPixelBufferGetWidth(rhs),
          CVPixelBufferGetHeight(lhs) == CVPixelBufferGetHeight(rhs),
          CVPixelBufferGetPixelFormatType(lhs) == kCVPixelFormatType_32BGRA,
          CVPixelBufferGetPixelFormatType(rhs) == kCVPixelFormatType_32BGRA else { return false }
    CVPixelBufferLockBaseAddress(lhs, .readOnly)
    CVPixelBufferLockBaseAddress(rhs, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(rhs, .readOnly); CVPixelBufferUnlockBaseAddress(lhs, .readOnly) }
    guard let a = CVPixelBufferGetBaseAddress(lhs), let b = CVPixelBufferGetBaseAddress(rhs) else { return false }
    let bytes = CVPixelBufferGetWidth(lhs) * 4
    for row in 0..<CVPixelBufferGetHeight(lhs) {
        if memcmp(a.advanced(by: row * CVPixelBufferGetBytesPerRow(lhs)), b.advanced(by: row * CVPixelBufferGetBytesPerRow(rhs)), bytes) != 0 { return false }
    }
    return true
}

// All encoder state is confined to the capture queue. One unacknowledged frame
// bounds every stage and prevents dropping dependent H.264 frames. New samples
// replace the pending pixel buffer, never an already encoded reference frame.
final class HostApplicationStream: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    // Main-thread lifecycle: ScreenCaptureKit stop must wait for start to finish.
    private var starting = false
    private var retiring = false
    private var stopping = false
    private var stopCallbacks: [() -> Void] = []
    private let context = CIContext()
    private let queue = DispatchQueue(label: "redeven.host-application.frames", qos: .userInteractive)
    private var stopped = false
    private var encoder: VTCompressionSession?
    private var latest: CVPixelBuffer?
    private var sequence = 0
    private var sentSequence = 0
    private var inFlight: Int?
    private var sentAt: TimeInterval = 0
    private var lastEncoded: TimeInterval = 0
    private var changedAt: TimeInterval = 0
    private var refinedSequence = 0
    private var timer: DispatchSourceTimer?
    private var dimensions = CGSize.zero
    private var bitrate = 0
    private var adaptiveFactor = 1.0
    private var lastAdapted: TimeInterval = 0
    private var frameID = 0
    private var videoActive = false
    let generation: Int
    let settings: HostApplicationCaptureSettings
    let failed: (Error) -> Void
    init(generation: Int, settings: HostApplicationCaptureSettings, failed: @escaping (Error) -> Void) {
        self.generation = generation; self.settings = settings; self.failed = failed
    }
    private func failure(_ error: Error) {
        guard !stopped else { return }
        DispatchQueue.main.async { if !self.retiring { self.failed(error) } }
    }
    func start(_ window: SCWindow, completion: @escaping () -> Void) {
        starting = true
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let sourceScale: Double
        if #available(macOS 14.0, *) { sourceScale = Double(filter.pointPixelScale) }
        else {
            // ScreenCaptureKit reports points on macOS 13. Convert AppKit's
            // bottom-left screen coordinates to WindowServer's top-left space.
            let top = NSScreen.screens.first?.frame.maxY ?? 0
            sourceScale = Double(NSScreen.screens.max { a, b in
                func area(_ screen: NSScreen) -> Double {
                    let rect = CGRect(x: screen.frame.minX, y: top - screen.frame.maxY, width: screen.frame.width, height: screen.frame.height).intersection(window.frame)
                    return rect.isNull ? 0 : rect.width * rect.height
                }
                return area(a) < area(b)
            }?.backingScaleFactor ?? 1)
        }
        dimensions = settings.dimensions(points: window.frame.size, sourceScale: max(1, sourceScale))
        let configuration = SCStreamConfiguration()
        configuration.width = Int(dimensions.width); configuration.height = Int(dimensions.height)
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: Int32(settings.frameRate))
        configuration.queueDepth = 3
        configuration.showsCursor = false
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        if #available(macOS 14.2, *) { configuration.includeChildWindows = true }
        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        self.stream = stream
        queue.async {
            self.prepareEncoder()
            let timer = DispatchSource.makeTimerSource(queue: self.queue)
            timer.schedule(deadline: .now(), repeating: 1.0 / Double(self.settings.frameRate))
            timer.setEventHandler { [weak self] in self?.produce() }
            self.timer = timer; timer.resume()
        }
        do {
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
            stream.startCapture { error in
                DispatchQueue.main.async {
                    self.starting = false
                    if let error, !self.retiring { self.failed(error) }
                    self.finishStop()
                    completion()
                }
            }
        } catch {
            starting = false
            if !retiring { failed(error) }
            finishStop()
            completion()
        }
    }
    private func prepareEncoder() {
        guard settings.video else { return }
        var session: VTCompressionSession?
        let specification = [kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder: true] as CFDictionary
        guard VTCompressionSessionCreate(allocator: kCFAllocatorDefault, width: Int32(dimensions.width), height: Int32(dimensions.height), codecType: kCMVideoCodecType_H264, encoderSpecification: specification, imageBufferAttributes: nil, compressedDataAllocator: nil, outputCallback: nil, refcon: nil, compressionSessionOut: &session) == noErr, let session else { return }
        let pixels = dimensions.width * dimensions.height
        bitrate = Int(min(32_000_000, max(1_000_000, pixels * Double(settings.frameRate) * (settings.mode == "data" ? 0.06 : 0.12))))
        let properties: [CFString: Any] = [
            kVTCompressionPropertyKey_RealTime: true,
            kVTCompressionPropertyKey_AllowFrameReordering: false,
            kVTCompressionPropertyKey_MaxFrameDelayCount: 0,
            kVTCompressionPropertyKey_ProfileLevel: kVTProfileLevel_H264_Main_AutoLevel,
            kVTCompressionPropertyKey_ExpectedFrameRate: settings.frameRate,
            kVTCompressionPropertyKey_MaxKeyFrameInterval: settings.frameRate * 2,
            kVTCompressionPropertyKey_AverageBitRate: bitrate,
        ]
        guard VTSessionSetProperties(session, propertyDictionary: properties as CFDictionary) == noErr,
              VTCompressionSessionPrepareToEncodeFrames(session) == noErr else { VTCompressionSessionInvalidate(session); return }
        encoder = session; videoActive = true
    }
    func stop(completion: @escaping () -> Void = {}) {
        retiring = true
        stopCallbacks.append(completion)
        queue.async {
            self.stopped = true; self.timer?.cancel(); self.timer = nil
            if let encoder = self.encoder { VTCompressionSessionInvalidate(encoder) }
            self.encoder = nil; self.latest = nil
        }
        finishStop()
    }
    private func finishStop() {
        guard retiring, !starting, !stopping else { return }
        guard let stream else {
            let callbacks = stopCallbacks; stopCallbacks.removeAll()
            for callback in callbacks { callback() }
            return
        }
        stopping = true
        stream.stopCapture { _ in
            DispatchQueue.main.async {
                self.stream = nil; self.stopping = false
                self.finishStop()
            }
        }
    }
    func acknowledge(_ id: Int) {
        queue.async {
            guard self.inFlight == id, !self.stopped else { return }
            let now = ProcessInfo.processInfo.systemUptime
            let elapsed = now - self.sentAt
            self.inFlight = nil
            // Auto adjusts compression to sustained delivery pressure, retaining
            // Retina resolution and restoring lossless text after motion stops.
            if self.settings.mode == "auto", let encoder = self.encoder, now - self.lastAdapted > 2 {
                let factor = elapsed > 0.12 ? max(0.3, self.adaptiveFactor * 0.8) : elapsed < 0.05 ? min(1, self.adaptiveFactor + 0.1) : self.adaptiveFactor
                self.adaptiveFactor = factor; self.lastAdapted = now
                VTSessionSetProperty(encoder, key: kVTCompressionPropertyKey_AverageBitRate, value: NSNumber(value: Int(Double(self.bitrate) * factor)))
            }
            self.produce()
        }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) { queue.async { self.failure(error) } }
    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard !stopped, type == .screen, sample.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let status = attachments.first?[.status] as? Int, status == SCFrameStatus.complete.rawValue,
              let buffer = sample.imageBuffer else { return }
        if let latest, hostApplicationPixelsEqual(latest, buffer) { return }
        latest = buffer; sequence += 1; changedAt = ProcessInfo.processInfo.systemUptime
        produce()
    }
    private func produce() {
        guard !stopped, inFlight == nil, let buffer = latest else { return }
        let now = ProcessInfo.processInfo.systemUptime
        let refine = now - changedAt >= 0.4 && refinedSequence != sequence
        guard (sequence != sentSequence || refine), now - lastEncoded >= 1.0 / Double(settings.frameRate) else { return }
        sentSequence = sequence; lastEncoded = now; frameID += 1; inFlight = frameID; sentAt = now
        if refine { refinedSequence = sequence }
        let id = frameID
        if let encoder, !refine {
            let result = VTCompressionSessionEncodeFrame(encoder, imageBuffer: buffer, presentationTimeStamp: CMTime(seconds: now, preferredTimescale: 1_000_000), duration: .invalid, frameProperties: nil, infoFlagsOut: nil) { [weak self] status, _, sample in
                guard let self else { return }
                self.queue.async {
                    guard !self.stopped, self.inFlight == id else { return }
                    guard status == noErr, let sample, let data = sample.dataBuffer,
                          let format = sample.formatDescription else { self.fallbackToImages(buffer, id: id); return }
                    let length = CMBlockBufferGetDataLength(data)
                    var bytes = Data(count: length)
                    let copied = bytes.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(data, atOffset: 0, dataLength: length, destination: $0.baseAddress!) }
                    guard copied == noErr else { self.fallbackToImages(buffer, id: id); return }
                    let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]]
                    let key = attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool != true
                    var metadata: [String: Any] = ["codec": "h264", "key": key, "timestamp": Int(now * 1_000_000)]
                    if key {
                        let extensions = CMFormatDescriptionGetExtensions(format) as NSDictionary?
                        guard let atoms = extensions?[kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms] as? NSDictionary,
                              let avcc = atoms["avcC"] as? Data, avcc.count >= 4 else { self.fallbackToImages(buffer, id: id); return }
                        metadata["description"] = avcc.base64EncodedString()
                        metadata["profile"] = "avc1." + avcc[1...3].map { String(format: "%02X", $0) }.joined()
                    }
                    self.output(bytes, id: id, metadata: metadata)
                }
            }
            if result != noErr { fallbackToImages(buffer, id: id) }
        } else { outputImage(buffer, id: id, lossless: refine) }
    }
    private func fallbackToImages(_ buffer: CVPixelBuffer, id: Int) {
        if let encoder { VTCompressionSessionInvalidate(encoder) }
        encoder = nil; videoActive = false
        outputImage(buffer, id: id, lossless: false)
    }
    private func outputImage(_ buffer: CVPixelBuffer, id: Int, lossless: Bool) {
        autoreleasepool {
            let image = CIImage(cvPixelBuffer: buffer)
            guard let cg = context.createCGImage(image, from: image.extent) else { failure(NativeInput.unavailable()); return }
            let data = NSMutableData()
            guard let destination = CGImageDestinationCreateWithData(data, (lossless ? UTType.png : UTType.jpeg).identifier as CFString, 1, nil) else { failure(NativeInput.unavailable()); return }
            let options = lossless ? nil : [kCGImageDestinationLossyCompressionQuality: settings.imageQuality * (settings.mode == "auto" ? max(0.8, adaptiveFactor) : 1)] as CFDictionary
            CGImageDestinationAddImage(destination, cg, options)
            guard CGImageDestinationFinalize(destination) else { failure(NativeInput.unavailable()); return }
            output(data as Data, id: id, metadata: ["codec": lossless ? "png" : "jpeg", "key": true])
        }
    }
    private func output(_ data: Data, id: Int, metadata: [String: Any]) {
        var message = metadata
        message.merge(["type": "frame", "generation": generation, "frame_id": id, "data": data.base64EncodedString(),
                       "width": Int(dimensions.width), "height": Int(dimensions.height), "frame_rate": settings.frameRate,
                       "transport": videoActive ? "video" : "images", "mode": settings.mode]) { _, new in new }
        emit(message)
    }
}
