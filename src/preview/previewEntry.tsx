import React from "react";
import { createRoot } from "react-dom/client";
import "../theme/chrome.css";
import { PreviewDeck } from "./components/PreviewDeck";

const root = document.getElementById("root");
if (root) createRoot(root).render(<PreviewDeck />);
