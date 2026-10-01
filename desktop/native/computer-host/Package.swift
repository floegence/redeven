// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "RedevenComputerHost",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "redeven-computer-host", targets: ["RedevenComputerHost"])],
    dependencies: [.package(url: "https://github.com/floegence/floe-native-apps.git", exact: "0.22.2")],
    targets: [
        .executableTarget(name: "RedevenComputerHost", dependencies: [.product(name: "FloeNativeDesktop", package: "floe-native-apps")]),
        .testTarget(name: "RedevenComputerHostTests", dependencies: ["RedevenComputerHost"]),
    ]
)
