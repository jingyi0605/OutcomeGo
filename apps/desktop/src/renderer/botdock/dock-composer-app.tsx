import { useLayoutEffect, useRef } from "react";
import { useDockState } from "./botdock-app";
import { DockComposer, useDockComposer } from "./dock-composer";

export function DockComposerApp() {
  const bridge = window.botdock;
  const state = useDockState(bridge);
  const model = useDockComposer(bridge, state?.roster ?? []);
  const frameRef = useRef<HTMLDivElement>(null);
  const hasState = state !== null;
  const { addFiles } = model;

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || !bridge || !hasState) return;
    const stop = bridge.onDroppedFiles(({ files, rejected }) => {
      void addFiles(files, rejected);
    });
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      void addFiles([...event.dataTransfer.files]);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    const report = () => {
      const { width, height } = frame.getBoundingClientRect();
      bridge.resize(width, height, "composer");
    };
    const observer = new ResizeObserver(report);
    observer.observe(frame);
    report();
    return () => {
      observer.disconnect();
      stop();
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [bridge, hasState, addFiles]);

  if (!bridge || !state) return null;
  return (
    <div className="dock-frame dock-composer-frame" ref={frameRef}>
      <DockComposer bridge={bridge} model={model} state={state} />
    </div>
  );
}
