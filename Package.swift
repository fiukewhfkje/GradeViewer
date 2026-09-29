// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "GradeCore", platforms: [.macOS(.v14), .iOS(.v17)], products: [.library(name: "GradeCore", targets: ["GradeCore"])], targets: [.target(name: "GradeCore"), .testTarget(name: "GradeCoreTests", dependencies: ["GradeCore"])])
