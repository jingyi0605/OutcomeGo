import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BotDockApp } from "./botdock-app";
import { DockComposerApp } from "./dock-composer-app";
import "./botdock.css";

const root = document.getElementById("botdock-root");
if (root) {
  const isComposer = new URLSearchParams(window.location.search).get("surface") === "composer";
  createRoot(root).render(
    <StrictMode>
      {isComposer ? <DockComposerApp /> : <BotDockApp />}
    </StrictMode>
  );
}
