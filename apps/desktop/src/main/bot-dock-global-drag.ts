import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { constants, mkdtempSync } from "node:fs";
import { open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { attachmentSizeRejection } from "@outcomego/contracts/media-input";
import {
  BOT_DOCK_MAX_ATTACHMENTS,
  BOT_DOCK_MAX_TOTAL_BYTES,
  type BotDockAttachment,
  type DockRect,
  isRecord,
  parseBotDockAttachments,
} from "./bot-dock-model";

export type DropSurface = "dock" | "invitation" | "composer";
type DropTarget = DockRect & { surface: DropSurface };
type DropResult = { files: BotDockAttachment[]; rejected: boolean };
type FinishDrop = (result: DropResult) => void;

const DROP_ID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

async function readPromisedDrop(
  directory: string,
  names: unknown[],
  rejected: boolean
): Promise<DropResult> {
  const files: BotDockAttachment[] = [];
  let remaining = BOT_DOCK_MAX_TOTAL_BYTES;
  for (const name of new Set(names.slice(0, BOT_DOCK_MAX_ATTACHMENTS))) {
    if (typeof name !== "string" || !name || name !== basename(name) || name === "..") continue;
    try {
      const file = await open(
        join(directory, name),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      );
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > remaining || attachmentSizeRejection(name, stat.size))
          continue;
        const bytes = new Uint8Array(stat.size);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        if (offset !== bytes.length) continue;
        files.push({ bytes, fileName: name, mimeType: "application/octet-stream" });
        remaining -= bytes.byteLength;
      } finally {
        await file.close();
      }
    } catch {}
  }
  const parsed = parseBotDockAttachments(files);
  return { files: parsed ?? [], rejected: rejected || !parsed || files.length !== names.length };
}

export interface GlobalDragDetectorOptions {
  /** Receives the helper's diagnostics. Giving it also asks the helper to report them. */
  log?: (line: string) => void;
}

export class GlobalDragDetector {
  private child: ChildProcessWithoutNullStreams | null = null;
  private dragging = false;
  private promised = false;

  constructor(
    private readonly helperPath: string,
    private readonly onDragChange: (dragging: boolean) => void,
    private readonly onDrop: (surface: DropSurface) => FinishDrop | null,
    private readonly options: GlobalDragDetectorOptions = {}
  ) {}

  start() {
    if (this.child) return;
    const args = ["--watch-file-drag"];
    let directory: string | undefined;
    try {
      directory = mkdtempSync(join(tmpdir(), "outcomego-drop-"));
      args.push("--file-drop-directory", directory);
    } catch (error) {
      console.warn("OutcomeGo could not create its file drop directory", error);
    }
    const { log } = this.options;
    if (log) args.push("--debug");
    // windowsHide: a console helper started from the app must not open a console window.
    const child = spawn(this.helperPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    const pending = new Map<string, FinishDrop>();
    child.stdin.on("error", () => {});
    if (log) createInterface({ input: child.stderr }).on("line", (line) => log(`stderr: ${line}`));
    else child.stderr.resume();
    createInterface({ input: child.stdout }).on("line", (line) => {
      if (this.child !== child) return;
      log?.(`stdout: ${line.length > 200 ? `${line.slice(0, 200)}…` : line}`);
      if (line.startsWith("ready ") && line !== "ready drag") {
        console.warn("OutcomeGo native helper does not support file drag detection");
        this.stop();
        return;
      }
      if (line === "drag-start") this.setDragging(true);
      if (line === "drag-start-promise") this.setDragging(true, true);
      if (line === "drag-end") this.setDragging(false);
      if (!directory) return;
      if (line.startsWith("drop-start ")) {
        const event = parseDropEvent(line.slice("drop-start ".length));
        if (!event || pending.has(event.id)) return;
        const { surface } = event;
        if (surface !== "dock" && surface !== "invitation" && surface !== "composer") return;
        const finish = this.onDrop(surface);
        if (finish) pending.set(event.id, finish);
      } else if (line.startsWith("drop-files ")) {
        const event = parseDropEvent(line.slice("drop-files ".length));
        const names: unknown = event?.names;
        if (!event || !Array.isArray(names)) return;
        const finish = pending.get(event.id);
        pending.delete(event.id);
        const path = join(directory, event.id);
        void (async () => {
          try {
            if (finish) {
              const result = await readPromisedDrop(path, names, event.rejected === true);
              if (this.child === child) finish(result);
            }
          } finally {
            await rm(path, { recursive: true, force: true }).catch(() => undefined);
          }
        })().catch((error: unknown) =>
          console.warn("OutcomeGo could not import dropped files", error)
        );
      }
    });
    const ended = () => {
      if (this.child !== child) return;
      this.child = null;
      this.setDragging(false);
    };
    child.once("error", (error) => {
      if (this.child !== child) return;
      console.warn("OutcomeGo file drag detection failed to start", error);
      ended();
    });
    child.once("close", () => {
      ended();
      pending.clear();
      if (directory) void rm(directory, { recursive: true, force: true }).catch(() => undefined);
    });
  }

  get receivingFilePromises() {
    return this.promised;
  }

  placeDropTargets(targets: DropTarget[]) {
    this.child?.stdin.write(`drop-targets ${JSON.stringify(targets)}\n`);
  }

  stop() {
    const child = this.child;
    this.child = null;
    child?.kill();
    this.setDragging(false);
  }

  private setDragging(dragging: boolean, promised = false) {
    if (dragging === this.dragging && promised === this.promised) return;
    this.dragging = dragging;
    this.promised = promised;
    this.onDragChange(dragging);
  }
}

function parseDropEvent(line: string): (Record<string, unknown> & { id: string }) | null {
  try {
    const value: unknown = JSON.parse(line);
    if (isRecord(value) && typeof value.id === "string" && DROP_ID.test(value.id)) {
      return { ...value, id: value.id };
    }
  } catch {
    return null;
  }
  return null;
}
