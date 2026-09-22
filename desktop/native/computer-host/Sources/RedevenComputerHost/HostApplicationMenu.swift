import ApplicationServices

// The viewer shares one application, not the Mac's system menu bar. Keep the
// exported tree and executable handles under the same native policy owner.
final class HostApplicationMenu {
    private var actions: [String: [AXUIElement]] = [:]
    private static let globalActions: Set<String> = ["hideOtherApplications:", "unhideAllApplications:"]

    func invalidate() { actions.removeAll() }

    private func root(_ application: AXUIElement) throws -> AXUIElement {
        guard let value = axValue(application, kAXMenuBarAttribute), CFGetTypeID(value) == AXUIElementGetTypeID() else { throw NativeInput.unavailable() }
        let element = unsafeBitCast(value, to: AXUIElement.self)
        guard axString(element, kAXRoleAttribute) == kAXMenuBarRole else { throw NativeInput.unavailable() }
        return element
    }

    private func children(_ element: AXUIElement, menuBar: Bool = false) -> [AXUIElement] {
        let children = axValue(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
        // macOS reserves the first main-menu entry for Apple. Its title and its
        // descendants' titles are not a locale-independent application boundary.
        let candidates = menuBar ? Array(children.dropFirst()) : children
        return candidates.filter { !Self.globalActions.contains(axString($0, kAXIdentifierAttribute)) }
    }

    func snapshot(_ application: AXUIElement) throws -> [[String: Any]] {
        invalidate()
        let root = try root(application)
        var count = 0
        func items(_ node: AXUIElement, path: [AXUIElement]) -> [[String: Any]] {
            guard path.count <= 6, count < 500 else { return [] }
            var result: [[String: Any]] = []
            for child in children(node, menuBar: path.count == 1) {
                count += 1
                if count > 500 { break }
                let title = axString(child, kAXTitleAttribute)
                let next = path + [child]
                let descendants = items(child, path: next)
                if title.isEmpty { result.append(contentsOf: descendants); continue }
                let isLeaf = axString(child, kAXRoleAttribute) == kAXMenuItemRole &&
                    (axValue(child, kAXChildrenAttribute) as? [AXUIElement] ?? []).isEmpty
                // An empty or entirely filtered submenu must not become an action.
                guard isLeaf || !descendants.isEmpty else { continue }
                let id = UUID().uuidString
                let enabled = (axValue(child, kAXEnabledAttribute) as? Bool) != false
                if isLeaf && enabled { actions[id] = next }
                result.append(["id": id, "title": title, "enabled": enabled, "children": descendants])
            }
            return result
        }
        return items(root, path: [root])
    }

    func takeAction(_ id: String, application: AXUIElement) throws -> AXUIElement {
        defer { invalidate() }
        guard let path = actions[id], let first = path.first, let item = path.last,
              CFEqual(first, try root(application)) else { throw NativeInput.invalid("The menu item is unavailable.") }
        // Apps can rebuild or move menu items without changing the selected
        // window. Revalidate the live ancestry and policy before pressing a leaf.
        for index in 1..<path.count {
            guard children(path[index - 1], menuBar: index == 1).contains(where: { CFEqual($0, path[index]) }),
                  (axValue(path[index], kAXEnabledAttribute) as? Bool) != false else {
                throw NativeInput.invalid("The menu item is unavailable.")
            }
        }
        guard axString(item, kAXRoleAttribute) == kAXMenuItemRole,
              (axValue(item, kAXChildrenAttribute) as? [AXUIElement] ?? []).isEmpty else {
            throw NativeInput.invalid("The menu item is unavailable.")
        }
        return item
    }
}
