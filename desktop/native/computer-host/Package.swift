// swift-tools-version: 5.9
import PackageDescription

let package = Package(name: "RedevenComputerHost", platforms: [.macOS(.v13)], products: [.executable(name: "redeven-computer-host", targets: ["RedevenComputerHost"])], targets: [.executableTarget(name: "RedevenComputerHost")])
