import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// Composes an opaque, full-bleed app icon from the shared Icon Composer document:
// the document's background gradient plus its first layer image. The layer image
// is drawn at Icon Composer's 1024pt artboard scale, so `layer-scale` matches the
// `position.scale` value in icon.json and both native and flat icons grow together.
//
// iOS, Android and the in-app About screen need flat icons without the native tile
// mask or transparency.
//
// Usage: compose-flat-icon <icon-directory> <output.png> <pixel-size> <layer-scale>

let arguments = CommandLine.arguments
guard arguments.count == 5 else {
  fputs("usage: compose-flat-icon <icon-directory> <output.png> <pixel-size> <layer-scale>\n", stderr)
  exit(2)
}

let iconDirectory = URL(fileURLWithPath: arguments[1], isDirectory: true)
let outputURL = URL(fileURLWithPath: arguments[2])
guard let pixelSize = Int(arguments[3]), pixelSize > 0,
      let layerScale = Double(arguments[4]), layerScale > 0 else {
  fputs("pixel-size and layer-scale must be positive\n", stderr)
  exit(2)
}

func fail(_ message: String) -> Never {
  fputs("compose-flat-icon: \(message)\n", stderr)
  exit(1)
}

guard let manifestData = try? Data(contentsOf: iconDirectory.appendingPathComponent("icon.json")),
      let manifest = (try? JSONSerialization.jsonObject(with: manifestData)) as? [String: Any] else {
  fail("cannot read icon.json in \(iconDirectory.path)")
}

func firstImageName(in manifest: [String: Any]) -> String? {
  for group in manifest["groups"] as? [[String: Any]] ?? [] {
    for layer in group["layers"] as? [[String: Any]] ?? [] {
      if let name = layer["image-name"] as? String { return name }
    }
  }
  return nil
}

guard let imageName = firstImageName(in: manifest) else {
  fail("icon.json has no image layer")
}

func parseColor(_ value: String) -> CGColor {
  // Icon Composer serializes colors as "srgb:r,g,b,a" with 0...1 components.
  let components = value.split(separator: ":", maxSplits: 1).last?
    .split(separator: ",")
    .compactMap { Double($0.trimmingCharacters(in: .whitespaces)) } ?? []
  guard components.count >= 3 else { fail("unsupported color \(value)") }
  let alpha = components.count > 3 ? components[3] : 1
  return CGColor(srgbRed: components[0], green: components[1], blue: components[2], alpha: alpha)
}

let fill = manifest["fill"] as? [String: Any] ?? [:]
guard let stops = fill["linear-gradient"] as? [String], stops.count >= 2 else {
  fail("only linear-gradient fills are supported")
}

let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
let colors = stops.map(parseColor) as CFArray
let locations = (0..<stops.count).map { CGFloat($0) / CGFloat(stops.count - 1) }
guard let gradient = CGGradient(colorsSpace: colorSpace, colors: colors, locations: locations) else {
  fail("cannot build background gradient")
}

guard let logoSource = CGImageSourceCreateWithURL(
  iconDirectory.appendingPathComponent("Assets/\(imageName)") as CFURL, nil),
  let logo = CGImageSourceCreateImageAtIndex(logoSource, 0, nil) else {
  fail("cannot read layer image \(imageName)")
}

// `noneSkipLast` keeps the iOS App Store icon free of an alpha channel.
guard let context = CGContext(
  data: nil, width: pixelSize, height: pixelSize, bitsPerComponent: 8,
  bytesPerRow: pixelSize * 4, space: colorSpace,
  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
  fail("cannot create \(pixelSize)x\(pixelSize) canvas")
}
context.interpolationQuality = .high

// The first gradient stop sits at the top of the icon.
context.drawLinearGradient(
  gradient,
  start: CGPoint(x: 0, y: pixelSize),
  end: CGPoint(x: 0, y: 0),
  options: [])

// Icon Composer renders a 1024pt artboard with layer images at their native pixel
// size; scale that artboard to the requested output size.
let canvas = CGFloat(pixelSize)
let artboardScale = canvas / 1024
let logoWidth = CGFloat(logo.width) * CGFloat(layerScale) * artboardScale
let logoHeight = CGFloat(logo.height) * CGFloat(layerScale) * artboardScale
context.draw(logo, in: CGRect(
  x: (canvas - logoWidth) / 2,
  y: (canvas - logoHeight) / 2,
  width: logoWidth,
  height: logoHeight))

guard let rendered = context.makeImage() else { fail("cannot render icon") }
try? FileManager.default.createDirectory(
  at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
guard let destination = CGImageDestinationCreateWithURL(
  outputURL as CFURL, UTType.png.identifier as CFString, 1, nil) else {
  fail("cannot write \(outputURL.path)")
}
CGImageDestinationAddImage(destination, rendered, nil)
guard CGImageDestinationFinalize(destination) else { fail("PNG export failed") }
