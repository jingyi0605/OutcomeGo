import { expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { BotDockBridge } from "../src/renderer/botdock/types";

const send = mock((_channel: string, _resizeId: number) => {});
const ipcRenderer = Object.assign(new EventEmitter(), { send });
let dockBridge: BotDockBridge;
mock.module("electron", () => ({
  contextBridge: {
    exposeInMainWorld(_key: string, bridge: BotDockBridge) {
      dockBridge = bridge;
    },
  },
  ipcRenderer,
}));
await import("../src/preload/botdock");

test("releases the compact frame only at the applied viewport and acknowledges after paint", () => {
  const viewport = Object.assign(new EventTarget(), { innerWidth: 356, innerHeight: 224 });
  const frames: FrameRequestCallback[] = [];
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: viewport,
    requestAnimationFrame: (frame: FrameRequestCallback) => frames.push(frame),
  })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const ready = mock((resizeId: number) => resizeId >= 2);
  const stop = dockBridge.onCompactViewportReady(ready);
  const resize = (width: number, height: number) => {
    Object.assign(viewport, { innerWidth: width, innerHeight: height });
    viewport.dispatchEvent(new Event("resize"));
  };
  const paint = () => {
    for (const frame of frames.splice(0)) frame(0);
  };
  try {
    ipcRenderer.emit("botdock:compact-viewport", {}, { resizeId: 1, width: 98, height: 72 });
    expect(ready).not.toHaveBeenCalled();
    resize(98, 72);
    expect(ready).toHaveBeenCalledWith(1);
    expect(frames).toHaveLength(0);

    ipcRenderer.emit("botdock:compact-viewport", {}, { resizeId: 2, width: 110, height: 72 });
    resize(110, 72);
    expect(ready).toHaveBeenLastCalledWith(2);
    paint();
    expect(send).not.toHaveBeenCalled();

    ipcRenderer.emit("botdock:compact-viewport", {}, { resizeId: 3, width: 122, height: 72 });
    paint();
    expect(send).not.toHaveBeenCalled();
    resize(122, 72);
    expect(ready).toHaveBeenLastCalledWith(3);
    paint();
    expect(send).not.toHaveBeenCalled();
    paint();
    expect(send.mock.calls).toEqual([["botdock:compact-painted", 3]]);
  } finally {
    stop();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
