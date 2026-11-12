/** Generate the flat, full-bleed app icons that cannot consume the Icon Composer document directly. */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type FlatIconTarget = { readonly path: string; readonly size: number };

export const FLAT_ICON_TARGETS: readonly FlatIconTarget[] = [
  { path: "apps/ios/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png", size: 1024 },
  { path: "apps/android/app/src/main/res/mipmap-mdpi/ic_launcher.png", size: 48 },
  { path: "apps/android/app/src/main/res/mipmap-hdpi/ic_launcher.png", size: 72 },
  { path: "apps/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png", size: 96 },
  { path: "apps/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png", size: 144 },
  { path: "apps/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png", size: 192 },
  { path: "apps/desktop/src/renderer/assets/outcomego-icon.png", size: 256 },
];

/** Read the logo layer's `position.scale` so the flat icons keep matching the Icon Composer source. */
function iconLayerScale(iconDirectory: string): number {
  const manifest = JSON.parse(readFileSync(join(iconDirectory, "icon.json"), "utf8")) as {
    groups?: { layers?: { position?: { scale?: number } }[] }[];
  };
  for (const group of manifest.groups ?? []) {
    for (const layer of group.layers ?? []) {
      if (layer?.position?.scale !== undefined) return layer.position.scale;
    }
  }
  return 1;
}

export function exportFlatAppIcons(options: {
  root: string;
  iconDirectory?: string;
  layerScale?: number;
  targets?: readonly FlatIconTarget[];
}): string[] {
  if (process.platform !== "darwin")
    throw new Error("Flat app icon export requires macOS with an Xcode toolchain.");
  const iconDirectory =
    options.iconDirectory ?? join(options.root, "packages/design-tokens/assets/outcomego.icon");
  const layerScale = options.layerScale ?? iconLayerScale(iconDirectory);
  const composer = join(import.meta.dir, "compose-flat-icon.swift");
  const written: string[] = [];
  for (const target of options.targets ?? FLAT_ICON_TARGETS) {
    const output = join(options.root, target.path);
    mkdirSync(dirname(output), { recursive: true });
    const result = spawnSync(
      "xcrun",
      ["swift", composer, iconDirectory, output, String(target.size), String(layerScale)],
      { encoding: "utf8" }
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `compose-flat-icon failed for ${target.path}: ${result.stderr || result.stdout}`
      );
    written.push(output);
  }
  return written;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    if (!args[index + 1]) throw new Error(`${name} needs a value`);
    return args[index + 1];
  };
  const root = resolve(option("--root") ?? join(import.meta.dir, "../.."));
  const layerScale = option("--layer-scale");
  const written = exportFlatAppIcons({
    root,
    layerScale: layerScale === undefined ? undefined : Number(layerScale),
  });
  console.log(
    `Exported ${written.length} flat app icons from the Icon Composer document to ${root}`
  );
}
