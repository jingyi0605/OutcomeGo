import type { BotDockStateView } from "../lib/bot-dock-state";

/** The bridge preload/botdock.ts exposes to this page. */
export interface BotDockBridge {
  platform: string;
  getState(): Promise<BotDockStateView | null>;
  onState(callback: (state: BotDockStateView | null) => void): () => void;
  onMessageArrival(callback: () => void): () => void;
  resize(
    width: number,
    height: number,
    layout: "compact" | "invitation" | "composer",
    compactResizeId?: number
  ): void;
  onCompactViewportReady(callback: (resizeId: number) => boolean): () => void;
  open(botId?: string): void;
  onComposer(
    callback: (composer: { open: boolean; up: boolean; right: boolean }) => void
  ): () => void;
  onDragHint(callback: (active: boolean) => void): () => void;
  send(message: {
    botId: string;
    content: string;
    nonce: string;
    attachments: Array<{
      bytes: Uint8Array;
      fileName: string;
      mimeType: string;
      width?: number;
      height?: number;
    }>;
  }): Promise<{ ok: boolean }>;
  drop(): void;
  closeComposer(): void;
  focusApp(): void;
  dragStart(): void;
  dragEnd(): void;
  contextMenu(): void;
}

declare global {
  interface Window {
    botdock?: BotDockBridge;
  }
}
