// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OutcomeGoCore",
    platforms: [.macOS(.v14), .iOS(.v18)],
    products: [.library(name: "OutcomeGoCore", targets: ["OutcomeGoCore"])],
    targets: [
        .target(name: "OutcomeGoCore", path: "Sources/Core", resources: [.process("Resources")]),
        .testTarget(name: "OutcomeGoCoreTests", dependencies: ["OutcomeGoCore"], path: "Tests/CoreTests", resources: [.copy("Fixtures")])
    ]
)
