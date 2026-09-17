import React from "react";
import { createRoot } from "react-dom/client";
import { TrayPanel } from "../../../src/tray/TrayPanel";

/**
 * Motion probe: mounts TrayPanel with canned props, replays the appear
 * animation 5x (remount per replay), and samples the animated element's
 * computed transform/opacity/filter via rAF. Results land on
 * window.__motion as { replays: Array<Array<{t, scale, opacity, blur}>> }.
 */
interface Sample { t: number; scale: number; opacity: number; blur: number }

const CANNED = {
  version: "1.0.0",
  recents: [
    { filename: "shot-a.png", kind: "screenshot" as const },
    { filename: "rec-b.mp4", kind: "recording" as const },
  ],
  hasPinnedWindows: false,
  hints: { 1: "Ctrl+Shift+4", 2: "Ctrl+Shift+3", 4: "Ctrl+Shift+O" },
  onCapture: () => {},
  onRecordingOptions: () => {},
  onOpenGallery: () => {},
  onOpenRecent: () => {},
  onUnpinAll: () => {},
  onOpenSettings: () => {},
  onQuit: () => {},
};

function parseScale(transform: string): number {
  const m = transform.match(/matrix\(([^)]+)\)/);
  if (!m) return 1;
  const parts = m[1].split(",").map(Number);
  return (Math.abs(parts[0]) + Math.abs(parts[3])) / 2;
}

function parseBlur(filter: string): number {
  const m = filter.match(/blur\(([-\d.]+)px\)/);
  return m ? Number(m[1]) : 0;
}

function App() {
  const [run, setRun] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (run >= 5) {
      (window as unknown as { __motionDone: boolean }).__motionDone = true;
      return;
    }
    const samples: Sample[] = [];
    const store = (window as unknown as { __motion?: { replays: Sample[][] } }).__motion ??
      ((window as unknown as { __motion: { replays: Sample[][] } }).__motion = { replays: [] });
    // Wait a frame for mount, then sample until settled.
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const el = rootRef.current?.querySelector(".glass-raised") as HTMLElement | null;
      if (el) {
        const cs = getComputedStyle(el);
        samples.push({
          t: performance.now() - t0,
          scale: parseScale(cs.transform),
          opacity: Number(cs.opacity),
          blur: parseBlur(cs.filter !== "none" ? cs.filter : "blur(0px)"),
        });
      }
      if (performance.now() - t0 < 900) {
        raf = requestAnimationFrame(tick);
      } else {
        store.replays.push(samples);
        setRun((r) => r + 1);
      }
    };
    const starter = requestAnimationFrame(() => {
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(starter);
      cancelAnimationFrame(raf);
    };
  }, [run ]);

  return (
    <div ref={rootRef} style={{ padding: 8 }}>
      <TrayPanel key={run} {...CANNED} />
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
