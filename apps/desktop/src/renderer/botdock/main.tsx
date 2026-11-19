import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BotDockApp } from "./botdock-app";
import { DockComposerApp } from "./dock-composer-app";
import "./botdock.css";

const root = document.getElementById("botdock-root");
if (root) {
  const surface = new URLSearchParams(window.location.search).get("surface");
  createRoot(root).render(
    <StrictMode>
      {surface === "composer" ? (
        <DockComposerApp />
      ) : (
        <BotDockApp invitation={surface === "invitation"} />
      )}
    </StrictMode>
  );
}
