import XCTest
@testable import RedevenComputerHost

final class ModelImageGeometryTests: XCTestCase {
    func testScaledCoordinatesAndLegacyDimensions() throws {
        let bounds = CGRect(x: 100, y: 200, width: 5120, height: 2880)
        let g = ModelImageGeometry(frame: "frame", documentID: "document", bounds: bounds, width: 5120, height: 2880)
        XCTAssertEqual(g.modelWidth, 2560)
        XCTAssertEqual(g.modelHeight, 1440)
        XCTAssertEqual(try g.point(x: 100, y: 120, frame: "frame", document: "document", currentBounds: bounds, changed: false), CGPoint(x: 300, y: 440))
        XCTAssertThrowsError(try g.point(x: 2560, y: 1, frame: "frame", document: "document", currentBounds: bounds, changed: false))
        XCTAssertThrowsError(try g.point(x: 1, y: 1, frame: "old", document: "document", currentBounds: bounds, changed: false))
        XCTAssertThrowsError(try g.point(x: 1, y: 1, frame: "frame", document: "document", currentBounds: bounds, changed: true))
        XCTAssertThrowsError(try g.point(x: 1, y: 1, frame: "frame", document: "document", currentBounds: bounds.offsetBy(dx: 1, dy: 0), changed: false))
    }
}
