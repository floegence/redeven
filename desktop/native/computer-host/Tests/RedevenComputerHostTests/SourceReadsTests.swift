import XCTest
@testable import RedevenComputerHost

final class SourceReadsTests: XCTestCase {
    func testLongUnicodeSourceReassemblesAndRejectsChangedCursor() throws {
        let full=String(repeating:"🌻\n",count:9000)+"END"
        let first=try nativeSourcePage(full,identity:"fixture",args:["limit":12000],metadata:[:])
        XCTAssertEqual(first["truncated"] as? Bool,true)
        let tail=try nativeSourcePage(full,identity:"fixture",args:["limit":12000,"cursor":first["next_cursor"]!],metadata:[:])
        XCTAssertEqual((first["value"] as! String)+(tail["value"] as! String),full)
        XCTAssertEqual(tail["truncated"] as? Bool,false)
        XCTAssertThrowsError(try nativeSourcePage(full+"changed",identity:"fixture",args:["cursor":first["next_cursor"]!],metadata:[:]))
        XCTAssertThrowsError(try nativeSourcePage(full,identity:"other",args:["cursor":first["next_cursor"]!],metadata:[:]))
    }
}
