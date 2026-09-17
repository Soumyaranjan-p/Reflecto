import React from "react";
import { createRoot } from "react-dom/client";
import { PreviewDeck } from "../../../src/preview/components/PreviewDeck";

/** Deck screenshot fixture. window.__deckStub must be set before this runs. */
function App() {
  return <PreviewDeck />;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
