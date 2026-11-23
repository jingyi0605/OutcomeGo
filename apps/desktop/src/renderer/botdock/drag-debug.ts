import type { BotDockBridge } from "./types";

/** A second drag event this soon after the last report is the same drag entering another element. */
const ENTER_REPORT_GAP_MS = 1000;

/**
 * With OUTCOMEGO_DOCK_DEBUG=1, reports what each drag over a dock page carries: the formats it
 * offers on entry, and the files the page could read on drop. A source the dock does not accept
 * (a chat app, a browser image) is then told apart by what it actually offers. Without the flag
 * it does nothing. Returns the cleanup for an effect.
 */
export function watchDragDiagnostics(bridge: BotDockBridge | undefined): (() => void) | undefined {
  const report = bridge?.debug ? bridge.debugLog : undefined;
  if (!report) return undefined;
  let lastEnter = 0;
  const describe = (name: string, event: DragEvent) => {
    const transfer = event.dataTransfer;
    report({
      event: name,
      types: [...(transfer?.types ?? [])],
      items: [...(transfer?.items ?? [])].map((item) => ({ kind: item.kind, type: item.type })),
      // Only readable on drop; empty while the drag is still in flight.
      files: [...(transfer?.files ?? [])].map((file) => ({
        name: file.name,
        type: file.type,
        size: file.size,
      })),
    });
  };
  const onEnter = (event: DragEvent) => {
    const now = Date.now();
    if (now - lastEnter < ENTER_REPORT_GAP_MS) return;
    lastEnter = now;
    describe("dragenter", event);
  };
  const onDrop = (event: DragEvent) => describe("drop", event);
  window.addEventListener("dragenter", onEnter);
  window.addEventListener("drop", onDrop);
  return () => {
    window.removeEventListener("dragenter", onEnter);
    window.removeEventListener("drop", onDrop);
  };
}
