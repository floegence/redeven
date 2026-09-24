import XCTest
import AppKit
@testable import RedevenComputerHost

final class HostApplicationTests: XCTestCase {
    func testRegistrySurvivesOmissionRestoresAndRetiresDestroyedSurfaces() throws {
        let app = NSRunningApplication.current
        let element = AXUIElementCreateApplication(app.processIdentifier)
        let child = AXUIElementCreateApplication(app.processIdentifier + 1)
        let registry = HostApplicationWindows()
        let bounds = CGRect(x: 10, y: 20, width: 640, height: 480)
        func read(_ elements: [AXUIElement], surface: Int = 42, visible: Bool = true, status: AXError = .success) -> HostApplicationWindows.Snapshot {
            registry.reconcile(app, application: element, elements: elements, candidates: [
                [kCGWindowNumber as String: NSNumber(value: surface), kCGWindowBounds as String: bounds.dictionaryRepresentation,
                 kCGWindowIsOnscreen as String: visible, kCGWindowLayer as String: 0]
            ], focused: nil, bounds: { _ in bounds }, passive: { _, _ in false }, roleStatus: { _ in status })
        }
        let first = try XCTUnwrap(read([element]).windows.first)
        first.observeDestruction(element: child, notification: kAXUIElementDestroyedNotification)
        for _ in 0..<5 {
            let missing = read([], visible: false, status: .cannotComplete)
            XCTAssertEqual(missing.state, .present)
            XCTAssertTrue(missing.windows.isEmpty, "Missing AX authority revokes capture/input, not lifetime")
            XCTAssertEqual(missing.retainedCount, 1)
        }
        let restored = try XCTUnwrap(read([element], surface: 43).windows.first)
        XCTAssertEqual(restored.id, first.id)
        XCTAssertEqual(restored.windowID, 43)
        restored.observeDestruction(element: element, notification: kAXUIElementDestroyedNotification)
        XCTAssertEqual(read([element], surface: 43).state, .confirmedEmpty, "A stale AX list must not resurrect a destroyed instance")
        for _ in 0..<5 {
            XCTAssertEqual(read([], surface: 43).state, .confirmedEmpty, "Cached visible surfaces must not block final closure")
        }
        let replacement = try XCTUnwrap(read([child], surface: 43).windows.first)
        XCTAssertNotEqual(replacement.id, restored.id, "Reused surface IDs do not reuse window authority")
        restored.observeDestruction(element: element, notification: kAXUIElementDestroyedNotification)
        XCTAssertEqual(read([child], surface: 43).windows.first?.id, replacement.id)
        registry.reset()
        XCTAssertNotEqual(read([child], surface: 43).windows.first?.id, replacement.id)
    }
    func testRegistryRequiresInvalidAXAndAbsentSurfaceWithoutNotification() {
        let app = NSRunningApplication.current
        let element = AXUIElementCreateApplication(app.processIdentifier)
        let registry = HostApplicationWindows()
        func read(_ elements: [AXUIElement], _ status: AXError) -> HostApplicationWindows.Snapshot {
            registry.reconcile(app, application: element, elements: elements, candidates: [], focused: nil,
                bounds: { _ in nil }, passive: { _, _ in false }, roleStatus: { _ in status })
        }
        XCTAssertEqual(read([element], .success).state, .present)
        XCTAssertEqual(read([], .cannotComplete).state, .unknown)
        XCTAssertEqual(read([], .apiDisabled).state, .unknown)
        XCTAssertEqual(read([], .invalidUIElement).state, .confirmedEmpty)
        XCTAssertEqual(read([], .success).retainedCount, 0)
    }
    func testKnownOffscreenWindowCannotConfirmClosureWhenAXOmitsIt() {
        XCTAssertEqual(HostApplicationWindows.retainedState(destructionObserved: false, axStatus: .cannotComplete, surfaceExists: true), .present)
        XCTAssertEqual(HostApplicationWindows.retainedState(destructionObserved: false, axStatus: .invalidUIElement, surfaceExists: true), .present)
    }
    func testDestructionRequiresExactEvidenceAndRetiresCachedSurfaces() {
        XCTAssertEqual(HostApplicationWindows.retainedState(destructionObserved: true, axStatus: .invalidUIElement, surfaceExists: true), .confirmedEmpty)
        XCTAssertEqual(HostApplicationWindows.retainedState(destructionObserved: false, axStatus: .invalidUIElement, surfaceExists: false), .confirmedEmpty)
        for status in [AXError.cannotComplete, .apiDisabled, .attributeUnsupported, .failure] {
            XCTAssertEqual(HostApplicationWindows.retainedState(destructionObserved: false, axStatus: status, surfaceExists: false), .unknown)
        }
        XCTAssertEqual(HostApplicationWindows.retainedState(destructionObserved: false, axStatus: .success, surfaceExists: false), .present)
    }
    func testOnlyTheRegisteredWindowDestructionUpdatesItsLifetime() {
        let app = NSRunningApplication.current
        let element = AXUIElementCreateApplication(app.processIdentifier)
        let another = AXUIElementCreateApplication(app.processIdentifier + 1)
        let window = NativeWindow(app: app, application: element, element: element, windowID: 42)
        window.observeDestruction(element: another, notification: kAXUIElementDestroyedNotification)
        window.observeDestruction(element: element, notification: kAXWindowCreatedNotification)
        XCTAssertFalse(window.destructionObserved)
        window.observeDestruction(element: element, notification: kAXUIElementDestroyedNotification)
        XCTAssertTrue(window.destructionObserved)
        let replacement = NativeWindow(app: app, application: element, element: another, windowID: 42)
        XCTAssertNotEqual(window.id, replacement.id)
        XCTAssertFalse(replacement.destructionObserved)
        let rebound = NativeWindow(app: app, application: element, element: another, windowID: 43, identity: replacement.id)
        XCTAssertEqual(rebound.id, replacement.id)
        XCTAssertNotEqual(rebound.windowID, replacement.windowID)
    }
    func testPassiveCaptureChromeRequiresPositiveEvidenceAndPreservesDialogs() {
        let bounds = CGRect(x: 100, y: 100, width: 500, height: 400)
        func passive(point: CGPoint? = CGPoint(x: -1, y: 1441), main: Bool? = false, focused: Bool? = false, modal: Bool? = false, controls: Bool = false) -> Bool {
            HostApplicationWindows.isPassiveSurface(bounds: bounds, activationPoint: point, mainSettable: main, focused: focused, modal: modal, hasControls: controls)
        }
        XCTAssertTrue(passive())
        XCTAssertFalse(passive(point: CGPoint(x: 110, y: 110)))
        XCTAssertFalse(passive(main: true))
        XCTAssertFalse(passive(focused: true))
        XCTAssertFalse(passive(modal: true))
        XCTAssertFalse(passive(controls: true))
        XCTAssertFalse(passive(point: nil))
        XCTAssertFalse(passive(main: nil))
        XCTAssertFalse(passive(focused: nil))
        XCTAssertFalse(passive(modal: nil))
    }
    func testInstanceIdentityChangesWhenProcessOrLaunchGenerationChanges() {
        let url = URL(fileURLWithPath: "/Applications/Fixture.app")
        let date = Date(timeIntervalSince1970: 1234)
        let original = HostApplicationCatalog.instanceIdentifier(url: url, pid: 123, launched: date)
        XCTAssertEqual(original, HostApplicationCatalog.instanceIdentifier(url: url, pid: 123, launched: date))
        XCTAssertNotEqual(original, HostApplicationCatalog.instanceIdentifier(url: url, pid: 124, launched: date))
        XCTAssertNotEqual(original, HostApplicationCatalog.instanceIdentifier(url: url, pid: 123, launched: date.addingTimeInterval(0.001)))
        XCTAssertNotEqual(original, HostApplicationCatalog.instanceIdentifier(url: URL(fileURLWithPath: "/Applications/Other.app"), pid: 123, launched: date))
    }
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
        let now: TimeInterval = 100
        XCTAssertFalse(presence.observe(.present, at: now))
        XCTAssertFalse(presence.observe(.confirmedEmpty, at: now))
        XCTAssertFalse(presence.observe(.unknown, at: now + 2))
        XCTAssertFalse(presence.observe(.confirmedEmpty, at: now + 3))
        XCTAssertTrue(presence.observe(.confirmedEmpty, at: now + 4))
    }
    func testUncertainOrOffscreenWindowsNeverExpireAndSessionsAreIndependent() {
        var first = HostApplicationWindowPresence(), second = HostApplicationWindowPresence()
        XCTAssertFalse(first.observe(.present, at: 0))
        XCTAssertFalse(first.observe(.confirmedEmpty, at: 1))
        XCTAssertFalse(first.observe(.unknown, at: 2))
        XCTAssertFalse(first.observe(.unknown, at: 100))
        XCTAssertFalse(first.observe(.present, at: 101))
        XCTAssertFalse(second.observe(.confirmedEmpty, at: 1000))
        XCTAssertFalse(first.observe(.confirmedEmpty, at: 102))
        XCTAssertFalse(first.observe(.confirmedEmpty, at: 102.999))
        XCTAssertTrue(first.observe(.confirmedEmpty, at: 103))
    }
    func testWindowReplacementDoesNotEndSession() {
        var presence = HostApplicationWindowPresence()
        let now: TimeInterval = 100
        XCTAssertFalse(presence.observe(.confirmedEmpty, at: now))
        XCTAssertFalse(presence.observe(.present, at: now))
        XCTAssertFalse(presence.observe(.confirmedEmpty, at: now))
        XCTAssertFalse(presence.observe(.present, at: now + 0.5))
        XCTAssertFalse(presence.observe(.confirmedEmpty, at: now + 2))
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
