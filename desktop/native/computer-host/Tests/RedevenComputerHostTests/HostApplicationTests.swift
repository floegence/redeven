import XCTest
import AppKit
@testable import RedevenComputerHost

final class HostApplicationTests: XCTestCase {
    func testCatalogUsesBundleMetadataAndCanonicalIdentity() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let bundle = root.appendingPathComponent("Unknown Host App.app")
        let contents = bundle.appendingPathComponent("Contents")
        try FileManager.default.createDirectory(at: contents.appendingPathComponent("MacOS"), withIntermediateDirectories: true)
        let info: [String: Any] = ["CFBundleIdentifier": "test.redeven.catalog", "CFBundlePackageType": "APPL", "CFBundleExecutable": "fixture", "CFBundleName": "A host-provided name"]
        try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0).write(to: contents.appendingPathComponent("Info.plist"))
        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: contents.appendingPathComponent("MacOS/fixture"))
        let alias = root.appendingPathComponent("Alias.app")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: bundle)
        XCTAssertEqual(HostApplicationCatalog.identifier(alias), HostApplicationCatalog.identifier(bundle))
        let apps = HostApplicationCatalog.applications(extra: [alias, bundle])
        XCTAssertEqual(apps.filter { HostApplicationCatalog.identifier($0) == HostApplicationCatalog.identifier(bundle) }.count, 1)
        let metadata = HostApplicationCatalog.describe(bundle)
        XCTAssertEqual(metadata["name"] as? String, "A host-provided name")
        XCTAssertEqual(metadata["description"] as? String, "")
        XCTAssertEqual(metadata["categories"] as? [String], [])
        XCTAssertTrue((metadata["icon"] as? String)?.hasPrefix("data:image/png;base64,") == true)
    }
    func testArbitraryDirectoryCannotBecomeAnApplication() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".app")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        XCTAssertFalse(HostApplicationCatalog.applications(extra: [root]).contains(root))
    }
}
