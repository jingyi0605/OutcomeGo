/** Export native platform icons from the shared Icon Composer document (Xcode 26+ on macOS). */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { exportFlatAppIcons } from "./export-flat-app-icons";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (!args[index + 1]) throw new Error(`${name} needs a value`);
  return args[index + 1];
};
const root = resolve(option("--root") ?? join(import.meta.dir, "../.."));
const source = join(root, "packages/design-tokens/assets/aiTeamOS.icon");
const output = resolve(option("--output") ?? join(root, "packages/design-tokens/assets"));
if (process.platform !== "darwin")
  throw new Error("Native icon export requires macOS and Xcode 26 or later.");

function run(command: string, commandArgs: string[]) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
// `xcode-select` can point at the Command Line Tools even when Xcode is installed,
// so fall back to the Icon Composer bundled inside /Applications/Xcode*.app.
function iconComposerTool() {
  const candidates = [
    join(
      dirname(run("xcode-select", ["--print-path"])),
      "Applications/Icon Composer.app/Contents/Executables/ictool"
    ),
  ];
  for (const app of readdirSync("/Applications").filter(
    (name) => name.startsWith("Xcode") && name.endsWith(".app")
  )) {
    candidates.push(
      join(
        "/Applications",
        app,
        "Contents/Applications/Icon Composer.app/Contents/Executables/ictool"
      )
    );
  }
  const tool = candidates.find((candidate) => existsSync(candidate));
  if (!tool)
    throw new Error(
      "Icon Composer is not installed; install Xcode 26 or later to export native app icons."
    );
  return tool;
}
const ictool = iconComposerTool();
const work = await mkdtemp(join(tmpdir(), "aiteamos-icon-export-"));
await mkdir(output, { recursive: true });

try {
  for (const [platform, stem] of [
    ["iOS", "ios"],
    ["macOS", "desktop"],
  ] as const) {
    for (const [rendition, appearance] of [
      ["Default", "light"],
      ["Dark", "dark"],
    ] as const) {
      run(ictool, [
        source,
        "--export-image",
        "--output-file",
        join(output, `aiteamos-${stem}-${appearance}.png`),
        "--platform",
        platform,
        "--rendition",
        rendition,
        "--width",
        "1024",
        "--height",
        "1024",
        "--scale",
        "1",
      ]);
    }
  }

  // macOS legacy ICNS uses an 824px rounded tile inside a 1024px canvas.
  // Icon Composer PNG exports are full bleed; applying the native inset prevents oversized Dock icons.
  const iconset = join(work, "aiTeamOS.iconset");
  await mkdir(iconset);
  const compositor = join(work, "mac-icon-inset.swift");
  await writeFile(
    compositor,
    `
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
let source = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
guard let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else { fatalError("Could not load native icon export") }
for points in [16, 32, 128, 256, 512] {
  for scale in [1, 2] {
    let pixels = points * scale
    guard let context = CGContext(data: nil, width: pixels, height: pixels, bitsPerComponent: 8,
      bytesPerRow: pixels * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fatalError("Could not create icon canvas") }
    context.interpolationQuality = .high
    let inset = Double(pixels) * 100.0 / 1024.0
    context.draw(image, in: CGRect(x: inset, y: inset, width: Double(pixels) - inset * 2, height: Double(pixels) - inset * 2))
    let suffix = scale == 2 ? "@2x" : ""
    let destinationURL = output.appendingPathComponent("icon_\\(points)x\\(points)\\(suffix).png")
    guard let rendered = context.makeImage(),
          let destination = CGImageDestinationCreateWithURL(destinationURL as CFURL, UTType.png.identifier as CFString, 1, nil) else { fatalError("Could not export icon") }
    CGImageDestinationAddImage(destination, rendered, nil)
    if !CGImageDestinationFinalize(destination) { fatalError("Could not write icon") }
  }
}
`
  );
  run("xcrun", ["swift", compositor, join(output, "aiteamos-desktop-light.png"), iconset]);
  run("iconutil", ["--convert", "icns", iconset, "--output", join(output, "icon.icns")]);

  // Self-contained ICO writer: electron-builder's converter downloads a toolset
  // from GitHub, which breaks offline branding rebuilds.
  run("xcrun", [
    "swift",
    join(import.meta.dir, "compose-windows-ico.swift"),
    join(output, "aiteamos-desktop-light.png"),
    join(output, "icon.ico"),
  ]);

  // The flat platform icons cannot use the native tile rendering, so compose them
  // from the same gradient and logo at a matched content ratio.
  const flatIcons = exportFlatAppIcons({ root });
  console.log(`Exported ${flatIcons.length} flat iOS/Android/desktop app icons`);
  console.log(
    `Exported iOS/macOS light and dark PNGs, full-size Mac ICNS and Windows ICO to ${output}`
  );
} finally {
  await rm(work, { recursive: true, force: true });
}
