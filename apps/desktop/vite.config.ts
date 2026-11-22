import { packEmojiPickerRuntimeEntries, type EmojiRuntimeSource } from "./src/renderer/components/outcomego/emoji/runtime-data";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Electron's Chromium runtime supports WOFF2; shipping KaTeX's WOFF and TTF
 * fallbacks only adds duplicate font payload to every installer. */
const katexWoff2Only = (): Plugin => ({
  name: "outcomego-katex-woff2-only",
  enforce: "pre",
  transform(source, id) {
    if (!/[\\/]katex[\\/]dist[\\/]katex\.min\.css(?:\?|$)/.test(id)) return;
    return source.replace(
      /src:(url\([^)]*?\.woff2\)\s*format\(["']woff2["']\))(?:,url\([^)]*?\.(?:woff|ttf)\)\s*format\(["'](?:woff|truetype)["']\))+/g,
      "src:$1"
    );
  },
});

/** Keep only the English fields rendered or searched by the picker. The npm
 * corpus also contains hex codes, skin-tone metadata, and other fields that
 * otherwise survive JSON bundling even though the desktop never reads them. */
const emojiPickerRuntimeData = (): Plugin => ({
  name: "outcomego-emoji-picker-runtime-data",
  enforce: "pre",
  transform(source, id) {
    if (!/[\\/]emojibase-data[\\/]en[\\/]compact\.json(?:\?|$)/.test(id)) return;
    const entries = packEmojiPickerRuntimeEntries(JSON.parse(source) as EmojiRuntimeSource[]);
    return JSON.stringify(entries);
  },
});

/** Opt-in build evidence for finding what actually contributes to each chunk.
 * It is intentionally absent from ordinary and release builds. */
const bundleModuleAudit = (): Plugin => ({
  name: "outcomego-bundle-module-audit",
  generateBundle(_options, bundle) {
    if (process.env.OUTCOMEGO_BUILD_ANALYZE !== "1") return;
    const chunks = Object.values(bundle)
      .filter((output) => output.type === "chunk")
      .map((chunk) => ({
        file: chunk.fileName,
        bytes: chunk.code.length,
        modules: Object.entries(chunk.modules)
          .map(([id, details]) => ({
            id,
            renderedBytes: details.renderedLength,
          }))
          .sort((left, right) => right.renderedBytes - left.renderedBytes),
      }))
      .sort((left, right) => right.bytes - left.bytes);
    this.emitFile({
      type: "asset",
      fileName: "bundle-module-audit.json",
      source: JSON.stringify({ generatedAt: new Date().toISOString(), chunks }, null, 2),
    });
  },
});

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    katexWoff2Only(),
    emojiPickerRuntimeData(),
    bundleModuleAudit(),
    tailwindcss(),
  ],
  server: {
    host: process.env.OUTCOMEGO_DEV_HOST ?? "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: process.env.OUTCOMEGO_SERVER_URL ?? "http://127.0.0.1:8787", ws: true },
    },
  },
  // These parsers load inside one-shot preview workers. Discovering them on the
  // first file open restarts Vite's dependency graph and strands that worker.
  optimizeDeps: { include: ["mammoth", "xlsx"] },
  worker: { format: "es" },
  build: {
    target: "chrome140",
    modulePreload: { polyfill: false },
    manifest: "manifest.json",
    outDir: "dist",
    // Let lifecycle/resource modules follow automatic chunking. Fixed groups can
    // import React from their importing entry and create an initialization cycle.
    // Shared plugin primitives must not pull their parent screens into a detail
    // chunk. These modules declare components/functions without startup effects.
    rolldownOptions: {
      // The floating screenbot composer and the Bot capsule are their own small pages
      // (src/renderer/screenbot, src/renderer/botdock).
      input: { index: "index.html", screenbot: "screenbot.html", botdock: "botdock.html" },
      output: { codeSplitting: { groups: [{
      name: "plugin-common",
      test: /(?:plugins\/(?:plugin-ui|plugin-mark|plugin-authorization)|product-core\/src\/plugin-authorization|renderer\/lib\/plugin-settings-scale)\.(?:ts|tsx)$/,
      includeDependenciesRecursively: false,
    }] } },
    },
  },
});
