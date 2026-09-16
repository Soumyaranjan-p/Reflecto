import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../theme/chrome.css";

type Step = "welcome" | "permissions" | "shortcuts" | "firstCapture";
const STEPS: Step[] = ["welcome", "permissions", "shortcuts", "firstCapture"];

function OnboardingApp() {
  const [step, setStep] = useState<Step>("welcome");
  const [note, setNote] = useState("");
  const idx = STEPS.indexOf(step);

  const finish = async (openBar: boolean) => {
    await window.reflecto?.onboardingComplete?.(openBar);
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--reflecto-workspace)", color: "var(--reflecto-label)" }}>
      <div style={{ flex: 1, overflow: "auto", padding: 28, maxWidth: 560, margin: "0 auto", width: "100%" }}>
        {step === "welcome" && (
          <>
            <h1 style={{ fontSize: 28, marginTop: 8 }}>Welcome to Reflecto</h1>
            <p>Capture, edit, and share screenshots and screen recordings on Windows.</p>
          </>
        )}
        {step === "permissions" && (
          <>
            <h1 style={{ fontSize: 24 }}>Permissions</h1>
            <p>Windows will prompt for mic, camera, and screen capture the first time you record. Microphone and camera stay off until you choose them.</p>
            <ul>
              <li>Screen capture — required to record</li>
              <li>Microphone — optional</li>
              <li>Camera — optional overlay</li>
            </ul>
          </>
        )}
        {step === "shortcuts" && (
          <>
            <h1 style={{ fontSize: 24 }}>Shortcuts</h1>
            <p>Defaults match BetterShot with Ctrl instead of Cmd:</p>
            <p><kbd>Ctrl+Shift+4</kbd> Region · <kbd>Ctrl+Shift+3</kbd> Screen · <kbd>Ctrl+Shift+2</kbd> Recording</p>
            <p>You can click a binding in Settings and press a new combination.</p>
          </>
        )}
        {step === "firstCapture" && (
          <>
            <h1 style={{ fontSize: 24 }}>First Capture</h1>
            <p>Practice: scribble a note, then open the capture bar.</p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Practice annotation…"
              style={{ width: "100%", minHeight: 120, background: "var(--reflecto-panel)", color: "inherit", border: "1px solid var(--reflecto-border)", borderRadius: 8, padding: 8 }}
            />
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, padding: 20, borderTop: "1px solid var(--reflecto-separator)", alignItems: "center" }}>
        {idx > 0 && (
          <button type="button" className="editor-button" onClick={() => setStep(STEPS[idx - 1])}>Back</button>
        )}
        <span style={{ fontSize: 12, color: "var(--reflecto-secondary)" }}>{idx + 1} of {STEPS.length}</span>
        <div style={{ flex: 1 }} />
        <button type="button" className="editor-button" onClick={() => void finish(true)}>Skip Setup</button>
        <button
          type="button"
          className="editor-button selected"
          onClick={() => {
            if (step === "firstCapture") void finish(true);
            else setStep(STEPS[idx + 1]);
          }}
        >
          {step === "welcome" ? "Get Started" : step === "firstCapture" ? "Open Capture Bar" : "Continue"}
        </button>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<OnboardingApp />);
