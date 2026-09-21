import XCTest
import CoreVideo
@testable import RedevenComputerHost

final class HostApplicationCaptureTests: XCTestCase {
    func testRetinaUsesPhysicalPixelsWithoutUpscalingSource() throws {
        let settings = try HostApplicationCaptureSettings(request: ["pixel_ratio": 2])
        XCTAssertEqual(settings.dimensions(points: CGSize(width: 1000, height: 700), sourceScale: 2), CGSize(width: 2000, height: 1400))
        XCTAssertEqual(settings.dimensions(points: CGSize(width: 1000, height: 700), sourceScale: 1), CGSize(width: 1000, height: 700))
    }
    func testResolutionCapPreservesAspectAndEncoderAlignment() throws {
        let settings = try HostApplicationCaptureSettings(request: ["pixel_ratio": 2, "max_dimension": 1920])
        XCTAssertEqual(settings.dimensions(points: CGSize(width: 1920, height: 1080), sourceScale: 2), CGSize(width: 1920, height: 1080))
    }
    func testProfilesAndExplicitLimitsAreBounded() throws {
        XCTAssertEqual(try HostApplicationCaptureSettings(request: [:]).frameRate, 30)
        XCTAssertEqual(try HostApplicationCaptureSettings(request: ["mode": "smooth"]).frameRate, 60)
        XCTAssertEqual(try HostApplicationCaptureSettings(request: ["mode": "data"]).maxDimension, 1600)
        XCTAssertEqual(try HostApplicationCaptureSettings(request: ["mode": "smooth", "frame_rate": 24]).frameRate, 24)
        for request: [String: Any] in [["mode": 1], ["video": 1], ["video": "true"], ["pixel_ratio": true], ["pixel_ratio": Double.infinity], ["frame_rate": 120], ["max_dimension": 100000], ["mode": "unknown"]] {
            XCTAssertThrowsError(try HostApplicationCaptureSettings(request: request))
        }
    }
    func testUnchangedPixelsIgnoreRowPaddingAndDetectContentChanges() throws {
        func buffer() throws -> CVPixelBuffer {
            var pixel: CVPixelBuffer?
            XCTAssertEqual(CVPixelBufferCreate(nil, 7, 5, kCVPixelFormatType_32BGRA, nil, &pixel), kCVReturnSuccess)
            return try XCTUnwrap(pixel)
        }
        let a = try buffer(), b = try buffer()
        for (index, pixel) in [a, b].enumerated() {
            CVPixelBufferLockBaseAddress(pixel, [])
            let base = try XCTUnwrap(CVPixelBufferGetBaseAddress(pixel))
            let stride = CVPixelBufferGetBytesPerRow(pixel)
            memset(base, Int32(index), stride * 5)
            for row in 0..<5 { memset(base.advanced(by: row * stride), 42, 7 * 4) }
            CVPixelBufferUnlockBaseAddress(pixel, [])
        }
        XCTAssertTrue(hostApplicationPixelsEqual(a, b))
        CVPixelBufferLockBaseAddress(b, [])
        CVPixelBufferGetBaseAddress(b)!.storeBytes(of: UInt8(43), as: UInt8.self)
        CVPixelBufferUnlockBaseAddress(b, [])
        XCTAssertFalse(hostApplicationPixelsEqual(a, b))
    }

}
