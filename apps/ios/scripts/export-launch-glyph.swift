// Renders the static launch screen assets (LaunchGlyph.imageset, LaunchBackground.colorset)
// from the same PlanetMark view the app draws, so both stay identical.
//
//   swiftc -parse-as-library Sources/App/PlanetMark.swift scripts/export-launch-glyph.swift -o /tmp/export-launch-glyph
//   /tmp/export-launch-glyph apps/ios/Resources/Assets.xcassets
import AppKit
import SwiftUI

private func rgb(_ hex: UInt32) -> Color {
  Color(
    .sRGB, red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255,
    blue: Double(hex & 255) / 255)
}
private func component(_ hex: UInt32, _ shift: UInt32) -> String {
  String(format: "0x%02X", (hex >> shift) & 255)
}

/// Keep in step with NativePalette.background / NativePalette.text and LaunchSplashView.glyphSize.
private let side: CGFloat = 130
private let looks: [(name: String, canvas: UInt32, ink: UInt32)] = [
  ("light", 0xFCFCFC, 0x000000), ("dark", 0x141414, 0xFFFFFF),
]

@main @MainActor struct ExportLaunchGlyph {
  static func main() throws {
    guard CommandLine.arguments.count == 2 else {
      FileHandle.standardError.write(Data("usage: export-launch-glyph <Assets.xcassets>\n".utf8))
      exit(2)
    }
    let catalog = URL(fileURLWithPath: CommandLine.arguments[1])
    let images = catalog.appendingPathComponent("LaunchGlyph.imageset")
    let colors = catalog.appendingPathComponent("LaunchBackground.colorset")
    for folder in [images, colors] {
      try? FileManager.default.removeItem(at: folder)
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    }

    var imageEntries: [String] = []
    for look in looks {
      for scale in 1...3 {
        let renderer = ImageRenderer(
          content: PlanetMark(ink: rgb(look.ink), canvas: rgb(look.canvas))
            .frame(width: side, height: side))
        renderer.scale = CGFloat(scale)
        guard let image = renderer.cgImage,
          let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
        else { fatalError("could not render \(look.name)@\(scale)x") }
        let name = "launch-glyph-\(look.name)@\(scale)x.png"
        try png.write(to: images.appendingPathComponent(name))
        let appearance =
          look.name == "dark"
          ? ",\n      \"appearances\" : [ { \"appearance\" : \"luminosity\", \"value\" : \"dark\" } ]" : ""
        imageEntries.append(
          "    {\n      \"filename\" : \"\(name)\",\n      \"idiom\" : \"universal\",\n      \"scale\" : \"\(scale)x\"\(appearance)\n    }"
        )
      }
    }
    let info = "  \"info\" : { \"author\" : \"xcode\", \"version\" : 1 }"
    try "{\n  \"images\" : [\n\(imageEntries.joined(separator: ",\n"))\n  ],\n\(info)\n}\n"
      .write(to: images.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)

    func colorEntry(_ hex: UInt32, dark: Bool) -> String {
      let appearance =
        dark ? "      \"appearances\" : [ { \"appearance\" : \"luminosity\", \"value\" : \"dark\" } ],\n" : ""
      return
        "    {\n\(appearance)      \"color\" : { \"color-space\" : \"srgb\", \"components\" : { \"alpha\" : \"1.000\", \"red\" : \"\(component(hex, 16))\", \"green\" : \"\(component(hex, 8))\", \"blue\" : \"\(component(hex, 0))\" } },\n      \"idiom\" : \"universal\"\n    }"
    }
    try "{\n  \"colors\" : [\n\(colorEntry(looks[0].canvas, dark: false)),\n\(colorEntry(looks[1].canvas, dark: true))\n  ],\n\(info)\n}\n"
      .write(to: colors.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
    print("wrote \(imageEntries.count) images and the background colour to \(catalog.path)")
  }
}
