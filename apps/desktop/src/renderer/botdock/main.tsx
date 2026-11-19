import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BotDockApp } from "./botdock-app";
import "./botdock.css";

const root = document.getElementById("botdock-root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <BotDockApp />
    </StrictMode>
  );
}
