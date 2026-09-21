import XCTest
import AppKit
@testable import RedevenComputerHost

final class HostApplicationTests: XCTestCase {
    func testAccessBoundaryDistinguishesLockedSessionAndRevokedPermissions() {
        XCTAssertNil(HostApplicationCatalog.blockReason(console: true, screen: true, accessibility: true))
        for screen in [false, true] {
            for accessibility in [false, true] {
                XCTAssertEqual(HostApplicationCatalog.blockReason(console: false, screen: screen, accessibility: accessibility), "GRAPHICAL_SESSION_REQUIRED")
            }
        }
        XCTAssertEqual(HostApplicationCatalog.blockReason(console: true, screen: false, accessibility: true), "PERMISSION_REQUIRED")
        XCTAssertEqual(HostApplicationCatalog.blockReason(console: true, screen: true, accessibility: false), "PERMISSION_REQUIRED")
    }

    func testWindowBindingPrefersUniqueVisibleWindowOverRetiredSurfaces() {
        let bounds = CGRect(x: 63, y: 703, width: 971, height: 712)
        func candidate(_ id: Int, visible: Bool) -> [String: Any] {
            [kCGWindowNumber as String: NSNumber(value: id), kCGWindowBounds as String: bounds.dictionaryRepresentation,
             kCGWindowIsOnscreen as String: visible]
        }
        let retired = candidate(1, visible: false), live = candidate(2, visible: true)
        XCTAssertEqual(HostApplicationWindows.matchingWindowID(bounds, candidates: [retired, live]), 2)
        XCTAssertEqual(HostApplicationWindows.matchingWindowID(bounds, candidates: [retired]), 1)
        XCTAssertNil(HostApplicationWindows.matchingWindowID(bounds, candidates: [live, candidate(3, visible: true)]))
        XCTAssertNil(HostApplicationWindows.matchingWindowID(bounds, candidates: [retired, candidate(3, visible: false)]))
    }

    func testUnreadableInventoryCannotConfirmClosure() {
        var presence = HostApplicationWindowPresence()
        let now = Date()
        XCTAssertFalse(presence.observe(windowCount: 1, at: now))
        XCTAssertFalse(presence.observe(windowCount: 0, at: now))
        XCTAssertFalse(presence.observe(windowCount: nil, at: now.addingTimeInterval(2)))
        XCTAssertFalse(presence.observe(windowCount: 0, at: now.addingTimeInterval(3)))
        XCTAssertTrue(presence.observe(windowCount: 0, at: now.addingTimeInterval(4)))
    }
    func testWindowReplacementDoesNotEndSession() {
        var presence = HostApplicationWindowPresence()
        let now = Date()
        XCTAssertFalse(presence.observe(windowCount: 0, at: now))
        XCTAssertFalse(presence.observe(windowCount: 1, at: now))
        XCTAssertFalse(presence.observe(windowCount: 0, at: now))
        XCTAssertFalse(presence.observe(windowCount: 1, at: now.addingTimeInterval(0.5)))
        XCTAssertFalse(presence.observe(windowCount: 0, at: now.addingTimeInterval(2)))
    }

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
