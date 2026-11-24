// Vite config for scripts/dev/sandbox.sh: the desktop renderer's own config, with the dependency
// cache moved into the sandbox directory so it never shares node_modules/.vite with a normal
// `bun run dev` in apps/desktop.
import config from "../../apps/desktop/vite.config";

export default {
  ...config,
  cacheDir: process.env.OUTCOMEGO_SANDBOX_VITE_CACHE ?? "/tmp/outcomego-sandbox/vite-cache",
};
