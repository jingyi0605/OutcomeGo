import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// Build a multi-resolution Windows ICO from a source PNG without any external
// tooling. Entries are PNG-compressed (supported since Windows Vista) so the
// 256px rendition stays small; 16/24/32/48/64/128 are included for legacy shells.
//
// Usage: compose-windows-ico <source.png> <output.ico>

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
  fputs("usage: compose-windows-ico <source.png> <output.ico>\n", stderr)
  exit(2)
}
let sourceURL = URL(fileURLWithPath: arguments[1])
let outputURL = URL(fileURLWithPath: arguments[2])

func fail(_ message: String) -> Never {
  fputs("compose-windows-ico: \(message)\n", stderr)
  exit(1)
}

guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
  fail("cannot read \(sourceURL.path)")
}

let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
let sizes = [16, 24, 32, 48, 64, 128, 256]

func pngData(for image: CGImage) -> Data {
  let data = NSMutableData()
  guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
    fail("cannot encode PNG")
  }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else { fail("PNG encoding failed") }
  return data as Data
}

var payloads: [(size: Int, png: Data)] = []
for size in sizes {
  guard let context = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
    space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
    fail("cannot create \(size)x\(size) canvas")
  }
  context.interpolationQuality = .high
  context.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
  guard let scaled = context.makeImage() else { fail("cannot scale to \(size)px") }
  payloads.append((size, pngData(for: scaled)))
}

func appendUInt16(_ value: UInt16, to data: inout Data) {
  data.append(UInt8(value & 0xff))
  data.append(UInt8((value >> 8) & 0xff))
}
func appendUInt32(_ value: UInt32, to data: inout Data) {
  data.append(UInt8(value & 0xff))
  data.append(UInt8((value >> 8) & 0xff))
  data.append(UInt8((value >> 16) & 0xff))
  data.append(UInt8((value >> 24) & 0xff))
}

var output = Data()
// ICONDIR: reserved, type 1 (icon), image count.
appendUInt16(0, to: &output)
appendUInt16(1, to: &output)
appendUInt16(UInt16(payloads.count), to: &output)

var offset = 6 + 16 * payloads.count
for payload in payloads {
  // Width/height use 0 to mean 256 in the directory entry.
  output.append(payload.size >= 256 ? 0 : UInt8(payload.size))
  output.append(payload.size >= 256 ? 0 : UInt8(payload.size))
  output.append(0)  // palette count
  output.append(0)  // reserved
  appendUInt16(1, to: &output)  // color planes
  appendUInt16(32, to: &output)  // bits per pixel
  appendUInt32(UInt32(payload.png.count), to: &output)
  appendUInt32(UInt32(offset), to: &output)
  offset += payload.png.count
}
for payload in payloads { output.append(payload.png) }

try? FileManager.default.createDirectory(
  at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
do {
  try output.write(to: outputURL)
} catch {
  fail("cannot write \(outputURL.path): \(error)")
}
