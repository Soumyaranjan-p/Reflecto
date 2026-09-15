import React from "react";
import { createRoot } from "react-dom/client";
import "../theme/chrome.css";

function OverlayApp() {
  return <div style={{ width: "100vw", height: "100vh", background: "transparent" }} />;
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<OverlayApp />);
