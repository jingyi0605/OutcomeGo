import type { BotDockStateView } from "../lib/bot-dock-state";

export type DockSide = "left" | "right";

export interface DockComposerAnchor {
  right: boolean;
  bottom: boolean;
}

export interface DockFile {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}

/** The bridge preload/botdock.ts exposes to this page. */
export interface BotDockBridge {
  platform: string;
  getState(): Promise<BotDockStateView | null>;
  onState(callback: (state: BotDockStateView | null) => void): () => void;
  onMessageArrival(callback: () => void): () => void;
  onDockSide(callback: (side: DockSide) => void): () => void;
  onComposerAnchor(callback: (anchor: DockComposerAnchor | null) => void): () => void;
  resize(width: number, height: number, layout: "compact" | "invitation" | "composer"): void;
  onSurfaceVisible(callback: (visible: boolean) => void): () => void;
  open(botId?: string): void;
  openGoals(): void;
  attachDroppedFiles(files: DockFile[], rejected: boolean): void;
  onDroppedFiles(callback: (drop: { files: DockFile[]; rejected: boolean }) => void): () => void;
  setFileHover(active: boolean): void;
  send(message: {
    botId: string;
    content: string;
    nonce: string;
    goalMode?: boolean;
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
