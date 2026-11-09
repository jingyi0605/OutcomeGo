/**
 * Builds the provider icon set for the three clients from a checkout of
 * github.com/yetone/magpie (its `internal/gui/assets/icons`, which comes from lobehub/icons, MIT).
 *
 *   bun scripts/icons/export-provider-icons.ts <magpie-checkout>   write the assets
 *   bun scripts/icons/export-provider-icons.ts --check             verify the assets match the presets
 *
 * The icon names come from the contracts, so a preset without a mark cannot ship:
 *   desktop   apps/desktop/src/renderer/assets/provider-icons/<name>.svg
 *   iOS       apps/ios/Resources/Assets.xcassets/ProviderIcon-<name>.imageset  (vector, 1 file)
 *   Android   apps/android/app/src/main/res/drawable-nodpi/provider_<name>.png  (192 px; Android has no SVG decoder)
 * Names ending in "-color" keep their own colours; every other mark is one-colour (painted with currentColor)
 * and follows the text colour: a CSS mask on desktop, template rendering on iOS, a tint on Android
 * (its PNG is black on transparent).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  BUILTIN_PROVIDER_ICONS,
  GENERIC_PROTOCOL_ICONS,
  INFERENCE_PROVIDER_PRESETS,
} from "../../packages/contracts/src/index";

const root = resolve(import.meta.dir, "../..");
const desktopDir = join(root, "apps/desktop/src/renderer/assets/provider-icons");
const iosDir = join(root, "apps/ios/Resources/Assets.xcassets");
const androidDir = join(root, "apps/android/app/src/main/res/drawable-nodpi");
const generic = join(import.meta.dir, "generic");

export const wantedIcons = (): string[] =>
  [
    ...new Set([
      ...INFERENCE_PROVIDER_PRESETS.map((preset) => preset.icon),
      ...Object.values(BUILTIN_PROVIDER_ICONS),
      ...Object.values(GENERIC_PROTOCOL_ICONS),
    ]),
  ].sort();

const isGeneric = (name: string) => name.startsWith("generic-");
/** One-colour marks paint with currentColor, or with nothing at all (magpie's own is a bare path). */
const mono = (svg: string) => svg.includes("currentColor") || !/\sfill="(?!none)[^"]+"/.test(svg);

/** A bare path paints black by default; say currentColor so it follows the text colour. */
const withCurrentColor = (svg: string) =>
  svg.includes("currentColor") ? svg : svg.replace(/<svg\b/, '<svg fill="currentColor"');

const sourceFor = (magpie: string, name: string): string => {
  const path = isGeneric(name) ? join(generic, `${name}.svg`) : join(magpie, `internal/gui/assets/icons/${name}.svg`);
  if (!existsSync(path)) throw new Error(`Missing icon ${name} (${path})`);
  return readFileSync(path, "utf8");
};

/** Rendering never loads outside files or scripts, so an icon is plain vector data. */
const safe = (name: string, svg: string): string => {
  if (/<(script|foreignObject|image|style)\b|\son[a-z]+=|href\s*=\s*["'](?!#)/i.test(svg))
    throw new Error(`Icon ${name} contains active or external content`);
  return svg;
};

const contents = (template: boolean) =>
  JSON.stringify(
    {
      images: [{ filename: "icon.svg", idiom: "universal" }],
      info: { author: "xcode", version: 1 },
      properties: {
        "preserves-vector-representation": true,
        ...(template ? { "template-rendering-intent": "template" } : {}),
      },
    },
    null,
    2
  ) + "\n";

const write = (path: string, text: string | Uint8Array) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

const raster = (svg: string, tintBlack: boolean): Uint8Array => {
  const input = tintBlack ? svg.replace(/currentColor/g, "#000000") : svg;
  const result = spawnSync("rsvg-convert", ["-w", "192", "-h", "192", "-f", "png"], {
    input,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`rsvg-convert failed: ${result.stderr}`);
  return new Uint8Array(result.stdout);
};

const build = (magpie: string) => {
  for (const dir of [desktopDir, androidDir]) mkdirSync(dir, { recursive: true });
  const names = wantedIcons();
  for (const name of names) {
    const raw = safe(name, sourceFor(magpie, name));
    const svg = mono(raw) ? withCurrentColor(raw) : raw;
    // Clients decide tint by name alone: `-color` marks keep their colours, all others follow the text colour.
    if (mono(raw) === name.endsWith("-color"))
      throw new Error(`Icon ${name} breaks the naming rule: only one-colour marks may omit "-color"`);
    write(join(desktopDir, `${name}.svg`), svg);
    const set = join(iosDir, `ProviderIcon-${name}.imageset`);
    write(join(set, "icon.svg"), svg);
    write(join(set, "Contents.json"), contents(mono(svg)));
    write(join(androidDir, `provider_${name.replace(/-/g, "_")}.png`), raster(svg, mono(svg)));
  }
  // An icon that is no longer wanted does not linger.
  const keep = new Set(names);
  for (const file of readdirSync(desktopDir))
    if (file.endsWith(".svg") && !keep.has(file.slice(0, -4))) rmSync(join(desktopDir, file));
  for (const dir of readdirSync(iosDir))
    if (dir.startsWith("ProviderIcon-") && !keep.has(dir.slice(13, -9))) rmSync(join(iosDir, dir), { recursive: true });
  for (const file of readdirSync(androidDir))
    if (file.startsWith("provider_") && !keep.has(file.slice(9, -4).replace(/_/g, "-")))
      rmSync(join(androidDir, file));
  writeFileSync(
    join(desktopDir, "NOTICE.md"),
    `# Provider icons\n\nMarks come from [lobehub/icons](https://github.com/lobehub/lobe-icons) (MIT, © 2023 LobeHub), as\nbundled by [yetone/magpie](https://github.com/yetone/magpie) (MIT). The \`generic-*\` marks are ours.\nProduct names and logos are trademarks of their owners and appear only to identify the service.\nRegenerate with \`bun scripts/icons/export-provider-icons.ts <magpie-checkout>\`.\n`
  );
  console.log(`Wrote ${names.length} provider icons for desktop, iOS and Android`);
};

const check = () => {
  const missing: string[] = [];
  for (const name of wantedIcons()) {
    if (!existsSync(join(desktopDir, `${name}.svg`))) missing.push(`desktop ${name}`);
    if (!existsSync(join(iosDir, `ProviderIcon-${name}.imageset/icon.svg`))) missing.push(`ios ${name}`);
    if (!existsSync(join(androidDir, `provider_${name.replace(/-/g, "_")}.png`))) missing.push(`android ${name}`);
  }
  if (missing.length) {
    console.error(`Provider icons are missing:\n  ${missing.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`Provider icons are complete (${wantedIcons().length})`);
};

const arg = process.argv[2];
if (arg === "--check") check();
else if (arg) build(resolve(arg));
else {
  console.error("Usage: export-provider-icons.ts <magpie-checkout> | --check");
  process.exit(2);
}
