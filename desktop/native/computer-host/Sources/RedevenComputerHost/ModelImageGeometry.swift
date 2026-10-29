import Foundation

// One transient screenshot anchor belongs to the native window, never the viewer.
struct ModelImageGeometry {
    let frame: String
    let documentID: String
    let bounds: CGRect
    let width: Int
    let height: Int
    var modelWidth: Int { max(1, width * 2560 / max(2560, max(width, height))) }
    var modelHeight: Int { max(1, height * 2560 / max(2560, max(width, height))) }
    var payload: [String: Any] {
        ["frame": frame, "document_id": documentID, "coordinate_space": "model_pixels",
         "image": ["width": width, "height": height], "model_image": ["width": modelWidth, "height": modelHeight]]
    }
    func point(x: Double, y: Double, frame: String, document: String, currentBounds: CGRect, changed: Bool) throws -> CGPoint {
        guard frame == self.frame, document == documentID, currentBounds == bounds, !changed else {
            throw HostFailure(code: "STALE_REFERENCE", message: "Capture a fresh screenshot before using image coordinates.")
        }
        guard x.isFinite, y.isFinite, x >= 0, y >= 0, x < Double(modelWidth), y < Double(modelHeight) else {
            throw NativeInput.invalid("Coordinates are outside the model image.")
        }
        return CGPoint(x: bounds.minX + x * Double(width) / Double(modelWidth), y: bounds.minY + y * Double(height) / Double(modelHeight))
    }
}
