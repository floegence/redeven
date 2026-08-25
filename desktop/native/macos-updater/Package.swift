// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "RedevenMacOSUpdaterDependency",
    platforms: [.macOS(.v12)],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.9.4")
    ],
    targets: [
        .target(
            name: "RedevenMacOSUpdaterDependency",
            dependencies: [.product(name: "Sparkle", package: "Sparkle")]
        )
    ]
)
