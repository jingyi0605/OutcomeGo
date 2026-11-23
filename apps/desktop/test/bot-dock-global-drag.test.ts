import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GlobalDragDetector } from "../src/main/bot-dock-global-drag";

// The helpers are shell scripts that speak the native helper's protocol, so these run wherever
// there is a /bin/sh. The real helpers (Swift, Go) have their own tests.
const unixOnly = test.skipIf(process.platform === "win32");

const waitFor = async (done: () => boolean | Promise<boolean>) => {
  for (let attempt = 0; attempt < 300 && !(await done()); attempt++) await Bun.sleep(10);
};

const withDirectory = async (run: (directory: string) => Promise<void>) => {
  const directory = await mkdtemp(join(tmpdir(), "bot-dock-global-drag-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

unixOnly(
  "relays the helper's drag start and end, and starts it as the macOS helper is started",
  async () => {
    await withDirectory(async (directory) => {
      const helper = join(directory, "helper");
      const marker = join(directory, "over");
      const argsFile = join(directory, "args");
      await writeFile(
        helper,
        `#!/bin/sh
printf '%s\\n' "$@" > '${argsFile}'
printf '%s\\n' 'ready drag' 'drag-start'
while [ ! -e '${marker}' ]; do sleep 0.01; done
printf '%s\\n' 'drag-end'
while IFS= read -r line; do :; done
`,
        { mode: 0o700 }
      );
      const changes: boolean[] = [];
      const detector = new GlobalDragDetector(
        helper,
        (dragging) => changes.push(dragging),
        () => null
      );
      try {
        detector.start();
        await waitFor(() => changes.length >= 1);
        expect(changes).toEqual([true]);
        expect(detector.receivingFilePromises).toBe(false);
        await writeFile(marker, "");
        await waitFor(() => changes.length >= 2);
        expect(changes).toEqual([true, false]);

        const args = (await readFile(argsFile, "utf8")).trim().split("\n");
        expect(args.slice(0, 2)).toEqual(["--watch-file-drag", "--file-drop-directory"]);
        expect(args[2]).toContain("outcomego-drop-");
        // No diagnostics were asked for.
        expect(args).toHaveLength(3);
      } finally {
        detector.stop();
      }
    });
  }
);

unixOnly(
  "stopping the helper in the middle of a drag ends the drag, so the dock never stays grown",
  async () => {
    await withDirectory(async (directory) => {
      const helper = join(directory, "helper");
      await writeFile(
        helper,
        `#!/bin/sh
printf '%s\\n' 'ready drag' 'drag-start'
while IFS= read -r line; do :; done
`,
        { mode: 0o700 }
      );
      const changes: boolean[] = [];
      const detector = new GlobalDragDetector(
        helper,
        (dragging) => changes.push(dragging),
        () => null
      );
      detector.start();
      await waitFor(() => changes.length >= 1);
      expect(changes).toEqual([true]);
      detector.stop();
      expect(changes).toEqual([true, false]);
    });
  }
);

unixOnly("gives up on a helper that cannot watch file drags", async () => {
  await withDirectory(async (directory) => {
    const helper = join(directory, "helper");
    await writeFile(
      helper,
      `#!/bin/sh
printf '%s\\n' 'ready poll' 'drag-start'
while IFS= read -r line; do :; done
`,
      { mode: 0o700 }
    );
    const changes: boolean[] = [];
    const detector = new GlobalDragDetector(
      helper,
      (dragging) => changes.push(dragging),
      () => null
    );
    try {
      detector.start();
      await Bun.sleep(150);
      // "ready poll" is the key-chord mode: its drag-start must not be believed.
      expect(changes).toEqual([]);
    } finally {
      detector.stop();
    }
  });
});
