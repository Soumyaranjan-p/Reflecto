import React from "react";
import { createRoot } from "react-dom/client";
import "../theme/chrome.css";

function PreviewEntry() {
  return <div style={{ minWidth: 160, minHeight: 130 }} />;
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<PreviewEntry />);
