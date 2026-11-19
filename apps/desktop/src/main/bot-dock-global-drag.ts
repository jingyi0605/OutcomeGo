import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export class GlobalDragDetector {
  private child: ChildProcessWithoutNullStreams | null = null;
  private dragging = false;

  constructor(
    private readonly helperPath: string,
    private readonly onDragChange: (dragging: boolean) => void
  ) {}

  start() {
    if (this.child) return;
    const child = spawn(this.helperPath, ["--watch-file-drag"], { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    child.stderr.resume();
    createInterface({ input: child.stdout }).on("line", (line) => {
      if (this.child !== child) return;
      if (line.startsWith("ready ") && line !== "ready drag") {
        console.warn("OutcomeGo native helper does not support file drag detection");
        this.stop();
        return;
      }
      if (line === "drag-start") this.setDragging(true);
      if (line === "drag-end") this.setDragging(false);
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
    child.once("close", ended);
  }

  stop() {
    const child = this.child;
    this.child = null;
    child?.kill();
    this.setDragging(false);
  }

  private setDragging(dragging: boolean) {
    if (dragging === this.dragging) return;
    this.dragging = dragging;
    this.onDragChange(dragging);
  }
}
