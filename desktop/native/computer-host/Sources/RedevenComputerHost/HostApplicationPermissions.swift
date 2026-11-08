import FloeNativeDesktop

enum HostApplicationPermissions {
    static func perform(_ permission: String,
                        apply: (String) throws -> Void = NativeApplicationAccess.perform) throws {
        try apply(permission)
    }
}
