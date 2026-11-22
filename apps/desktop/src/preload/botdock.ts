import { contextBridge, ipcRenderer } from "electron";
import type { BotDockAttachment, BotDockState, DockAnchor, DockLayout } from "../main/bot-dock-model";

/** What the page hands over; main checks the bytes and decides an image's type itself. */
interface BotDockSendInput {
  botId: string;
  content: string;
  nonce: string;
  goalMode?: boolean;
  attachments: Array<
    Pick<BotDockAttachment, "bytes" | "fileName" | "mimeType" | "width" | "height">
  >;
}

/** The Bot floating window's whole bridge. It holds no account: main says what to show, and
 * the page only reports its size and what the person clicked. */
contextBridge.exposeInMainWorld("botdock", {
  platform: process.platform,
  getState: (): Promise<BotDockState | null> => ipcRenderer.invoke("botdock:get-state"),
  onState: (callback: (state: BotDockState | null) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: BotDockState | null) =>
      callback(state);
    ipcRenderer.on("botdock:state", listener);
    return () => ipcRenderer.removeListener("botdock:state", listener);
  },
  onMessageArrival: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("botdock:message-arrival", listener);
    return () => ipcRenderer.removeListener("botdock:message-arrival", listener);
  },
  onDockSide: (callback: (side: "left" | "right") => void) => {
    const listener = (_event: Electron.IpcRendererEvent, side: unknown) => {
      if (side === "left" || side === "right") callback(side);
    };
    ipcRenderer.on("botdock:side", listener);
    return () => ipcRenderer.removeListener("botdock:side", listener);
  },
  onComposerAnchor: (callback: (anchor: DockAnchor | null) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, anchor: DockAnchor | null) =>
      callback(anchor);
    ipcRenderer.on("botdock:composer-anchor", listener);
    return () => ipcRenderer.removeListener("botdock:composer-anchor", listener);
  },
  /** The capsule's size in CSS pixels; main sizes the window to it and shows it. */
  resize: (width: number, height: number, layout: DockLayout) =>
    ipcRenderer.send("botdock:resize", width, height, layout),
  onSurfaceVisible: (callback: (visible: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, visible: unknown) =>
      callback(visible === true);
    ipcRenderer.on("botdock:surface-visible", listener);
    return () => ipcRenderer.removeListener("botdock:surface-visible", listener);
  },
  attachDroppedFiles: (files: BotDockAttachment[], rejected: boolean) =>
    ipcRenderer.send("botdock:dropped-files", files, rejected),
  onDroppedFiles: (callback: (drop: { files: BotDockAttachment[]; rejected: boolean }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      drop: { files: BotDockAttachment[]; rejected: boolean }
    ) => callback(drop);
    ipcRenderer.on("botdock:dropped-files", listener);
    return () => ipcRenderer.removeListener("botdock:dropped-files", listener);
  },
  setFileHover: (active: boolean) => ipcRenderer.send("botdock:file-hover", active),
  /** Sends a message to a Bot through the signed-in window; this page has no account. */
  send: async (message: BotDockSendInput): Promise<{ ok: boolean }> => {
    try {
      const result: unknown = await ipcRenderer.invoke("botdock:send", message);
      return { ok: (result as { ok?: unknown } | null)?.ok === true };
    } catch {
      return { ok: false };
    }
  },
  /** Files were dropped: main opens the composer; the page attaches them. */
  drop: () => ipcRenderer.send("botdock:drop"),
  closeComposer: () => ipcRenderer.send("botdock:composer-close"),
  /** Brings the main window forward (the "+N" chip). */
  focusApp: () => ipcRenderer.send("botdock:focus-app"),
  /** The goal management entry was clicked: brings the app forward on the goals page. */
  openGoals: () => ipcRenderer.send("botdock:open-goals"),
  /** A Bot's avatar was clicked, or (without an id) the capsule's own button. */
  open: (botId?: string) =>
    ipcRenderer.send("botdock:open", typeof botId === "string" ? botId : null),
  dragStart: () => ipcRenderer.send("botdock:drag-start"),
  dragEnd: () => ipcRenderer.send("botdock:drag-end"),
  contextMenu: () => ipcRenderer.send("botdock:context-menu"),
});
