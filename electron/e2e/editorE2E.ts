import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { beautifyPNG } from "../preview/beautifier";
import { defaultBeautifierConfig } from "../../src/shared/beautifierTypes";
import { recognizeWords } from "../ocr/tesseract";
import { findSensitiveBoxes } from "../../src/shared/smartRedact";
import { exportEditedVideo } from "../recording/exportVideo";
import { resolveFfmpeg } from "../recording/ffmpeg";
import { openAnnotateEditor } from "../editor/annotatePresenter";
import { preloadPath } from "../paths";

const TMP = "C:\\Users\\soumy\\AppData\\Local\\Temp\\opencode";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function probe(file: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn(resolveFfmpeg(), ["-i", file], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stderr.on("data", (d) => { out += String(d); });
    proc.on("close", () => resolve(out));
    proc.on("error", (err) => resolve(String(err)));
  });
}

function streamSize(probeText: string): string | null {
  const line = probeText.split(/\r?\n/).find((l) => l.includes("Stream #") && l.includes("Video:"));
  return line?.trim() ?? null;
}

/** Average rgb of a 1px crop via ffmpeg (proves rendered color without eyes). */
function avgPixel(src: string, x: number, y: number): { r: number; g: number; b: number } {
  const raw = path.join(TMP, `px-${Date.now()}-${Math.round(Math.random() * 1e6)}.raw`);
  execFileSync(
    resolveFfmpeg(),
    ["-y", "-i", src, "-filter_complex", `crop=8:8:${x}:${y},scale=1:1`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw],
    { stdio: "ignore", windowsHide: true },
  );
  const b = fs.readFileSync(raw);
  try { fs.unlinkSync(raw); } catch { /* ignore */ }
  return { r: b[0], g: b[1], b: b[2] };
}

export async function runEditorE2E(): Promise<string> {
  const reportPath = path.join(app.getPath("userData"), "editor-e2e.json");
  const report: Record<string, unknown> = { startedAt: new Date().toISOString() };

  // A. Solid-color Default Look through the production staging path.
  try {
    const src = fs.readFileSync(path.join(TMP, "solid-src.png"));
    const solid = await beautifyPNG(src, {
      ...defaultBeautifierConfig,
      style: { kind: "solid", rgb: [18, 120, 220] },
      padding: 0.2,
      shadowStrength: 0,
    });
    const solidPath = path.join(app.getPath("userData"), "recordings", "e2e-solid-look.png");
    fs.writeFileSync(solidPath, solid);
    const solidProbe = await probe(solidPath);
    const corner = avgPixel(solidPath, 5, 5);
    const grad = await beautifyPNG(src, {
      ...defaultBeautifierConfig,
      style: { kind: "gradient", id: "soft-blue" },
      padding: 0.2,
      shadowStrength: 0,
    });
    const gradPath = path.join(app.getPath("userData"), "recordings", "e2e-gradient-look.png");
    fs.writeFileSync(gradPath, grad);
    const gradCorner = avgPixel(gradPath, 5, 5);
    const close = (a: number, b: number) => Math.abs(a - b) <= 3;
    report.solidLook = {
      path: solidPath,
      size: solid.length,
      video: streamSize(solidProbe),
      corner,
      gradCorner,
      solidOk: close(corner.r, 18) && close(corner.g, 120) && close(corner.b, 220),
      distinctFromGradient: Math.abs(gradCorner.r - 18) + Math.abs(gradCorner.g - 120) + Math.abs(gradCorner.b - 220) > 30,
    };
  } catch (err) {
    report.solidLook = { error: err instanceof Error ? err.stack || err.message : String(err) };
  }

  // B2. Look effects (camera / progressive blur / watermark / border).
  try {
    const fixture = process.env.REFLECTO_LOOK2B_FIXTURE;
    if (!fixture || !fs.existsSync(fixture)) throw new Error("REFLECTO_LOOK2B_FIXTURE bundle missing");
    const bundle = fs.readFileSync(fixture, "utf8");
    const win = new BrowserWindow({ width: 400, height: 400, show: false, webPreferences: { contextIsolation: true } });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<body><script>${bundle}</script></body>`)}`);
    let result: Record<string, unknown> | null = null;
    for (let i = 0; i < 200 && !result; i++) {
      await sleep(100);
      try {
        result = await win.webContents.executeJavaScript("window.__look2b || null", true);
      } catch { /* not ready */ }
    }
    win.destroy();
    if (!result) throw new Error("look2b fixture produced no result");
    report.look2b = result;
  } catch (err) {
    report.look2b = { error: err instanceof Error ? err.stack || err.message : String(err) };
  }
  try {
    const fixture = process.env.REFLECTO_ROT_FIXTURE;
    if (!fixture || !fs.existsSync(fixture)) throw new Error("REFLECTO_ROT_FIXTURE bundle missing");
    const bundle = fs.readFileSync(fixture, "utf8");
    const win = new BrowserWindow({ width: 300, height: 300, show: false, webPreferences: { contextIsolation: true } });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<body><script>${bundle}</script></body>`)}`);
    let result: Record<string, unknown> | null = null;
    for (let i = 0; i < 100 && !result; i++) {
      await sleep(100);
      try {
        result = await win.webContents.executeJavaScript("window.__rotResult || null", true);
      } catch { /* not ready */ }
    }
    win.destroy();
    if (!result) throw new Error("rotation fixture produced no result");
    report.rotation = { ...result, ok: (result as { pass?: boolean }).pass === true };
  } catch (err) {
    report.rotation = { error: err instanceof Error ? err.stack || err.message : String(err) };
  }

  // C. Smart Redact on a generated secrets image (real Tesseract).
  try {
    const png = fs.readFileSync(path.join(TMP, "smart-test.png"));
    const words = await recognizeWords(png);
    const boxes = findSensitiveBoxes(
      words,
      1200,
      420,
    );
    const band = (y: number) => (y < 130 ? "line1-email" : y < 240 ? "line2-card" : y < 370 ? "line3-jwt" : "outside");
    report.smartRedact = {
      wordCount: words.length,
      boxes: boxes.map((b) => ({ ...b, cy: Math.round(b.y + b.h / 2), band: band(b.y + b.h / 2) })),
      hasEmail: boxes.some((b) => b.kind === "email" && band(b.y + b.h / 2) === "line1-email"),
      hasCard: boxes.some((b) => b.kind === "card" && band(b.y + b.h / 2) === "line2-card"),
      hasJwt: boxes.some((b) => (b.kind === "jwt" || b.kind === "token") && band(b.y + b.h / 2) === "line3-jwt"),
    };
    const s = report.smartRedact as { hasEmail?: boolean; hasCard?: boolean; hasJwt?: boolean };
    (report.smartRedact as Record<string, unknown>).ok = Boolean(s.hasEmail && s.hasCard && s.hasJwt);
  } catch (err) {
    report.smartRedact = { error: err instanceof Error ? err.stack || err.message : String(err) };
  }

  // D. Real editor window: draw rect -> rotate via slider -> undo/redo,
  // comparing actual canvas pixels at each step.
  try {
    const shot = path.join(TMP, "ui-rect-src.png");
    execFileSync(
      resolveFfmpeg(),
      ["-y", "-f", "lavfi", "-i", "testsrc=s=320x200:r=10:d=1", "-frames:v", "1", shot],
      { stdio: "ignore", windowsHide: true },
    );
    openAnnotateEditor(shot);
    const js = async (code: string, retries = 50): Promise<unknown> => {
      for (let i = 0; i < retries; i++) {
        const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === "Reflecto Editor");
        if (win) {
  // B2. Look effects (camera / progressive blur / watermark / border).
  try {
            return await win.webContents.executeJavaScript(code, true);
          } catch { /* not ready */ }
        }
        await sleep(200);
      }
      throw new Error("editor window not ready");
    };
    await js("document.readyState");
    await js(`[...document.querySelectorAll('canvas')].length > 0 && document.querySelector('canvas').width > 0 ? 'ready' : Promise.reject('nocanvas')`);
    const editor = BrowserWindow.getAllWindows().find((w) => w.getTitle() === "Reflecto Editor")!;
    editor.focus();
    await sleep(400);
    const canvasHash = async () => {
      const url = (await js("document.querySelector('canvas').toDataURL('image/png')")) as string;
      return createHash("sha256").update(url).digest("hex").slice(0, 16);
    };
    const key = async (k: string) => {
      editor.webContents.sendInputEvent({ type: "keyDown", keyCode: k } as never);
      editor.webContents.sendInputEvent({ type: "keyUp", keyCode: k } as never);
      await sleep(300);
    };
    const rect = (await js(
      "JSON.stringify(document.querySelector('canvas').getBoundingClientRect())",
    )) as string;
    const { left, top, width: rw } = JSON.parse(rect) as { left: number; top: number; width: number };
    const cw = (await js("document.querySelector('canvas').width")) as number;
    const k = cw / rw; // canvas px per css px
    const click = async (cx: number, cy: number) => {
      const x = Math.round(left + cx / k);
      const y = Math.round(top + cy / k);
      editor.webContents.sendInputEvent({ type: "mouseMove", x, y });
      await sleep(60);
      editor.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
      await sleep(60);
      editor.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
      await sleep(250);
    };
    const drag = async (x1: number, y1: number, x2: number, y2: number) => {
      const a = { x: Math.round(left + x1 / k), y: Math.round(top + y1 / k) };
      const b = { x: Math.round(left + x2 / k), y: Math.round(top + y2 / k) };
      editor.webContents.sendInputEvent({ type: "mouseMove", x: a.x, y: a.y });
      await sleep(60);
      editor.webContents.sendInputEvent({ type: "mouseDown", x: a.x, y: a.y, button: "left", clickCount: 1 });
      for (let i = 1; i <= 5; i++) {
        editor.webContents.sendInputEvent({
          type: "mouseMove",
          x: Math.round(a.x + ((b.x - a.x) * i) / 5),
          y: Math.round(a.y + ((b.y - a.y) * i) / 5),
        });
        await sleep(40);
      }
      editor.webContents.sendInputEvent({ type: "mouseUp", x: b.x, y: b.y, button: "left", clickCount: 1 });
      await sleep(400);
    };
    const blankHash = await canvasHash();
    await key("r"); // rectangle tool
    await drag(40, 40, 140, 120); // canvas px
    const drewHash = await canvasHash();
    await key("h"); // select tool
    await click(90, 80); // select the rect (center)
    const sliderOk = (await js(
      `[...document.querySelectorAll('input[type=range]')].some(i => (i.title || '').startsWith('Rotate'))`,
    )) as boolean;
    await js(`(() => {
      const s = [...document.querySelectorAll('input[type=range]')].find(i => (i.title || '').startsWith('Rotate'));
      if (!s) throw new Error('no rotate slider');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(s, '90');
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return 'set';
    })()`);
    await sleep(500);
    const rotatedHash = await canvasHash();
    await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Undo').click()`);
    await sleep(400);
    const undoHash = await canvasHash();
    await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Redo').click()`);
    await sleep(400);
    // Redo restores annotations but not selection (Undo clears selectedId),
    // and the selection chrome paints onto the canvas — reselect first so the
    // comparison is pixels-of-annotations, not pixels-of-chrome.
    await click(90, 80);
    const redoHash = await canvasHash();
    editor.destroy();
    report.editorUI = {
      blankHash,
      drewHash,
      rotatedHash,
      undoHash,
      redoHash,
      sliderOk,
      drewDiffers: drewHash !== blankHash,
      rotatedDiffers: rotatedHash !== drewHash,
      undoRestores: undoHash === drewHash,
      redoRestores: redoHash === rotatedHash,
      ok: false,
    };
    const e = report.editorUI as Record<string, unknown>;
    e.ok = Boolean(e.drewDiffers && e.rotatedDiffers && e.undoRestores && e.redoRestores && sliderOk);
  } catch (err) {
    report.editorUI = { error: err instanceof Error ? err.stack || err.message : String(err) };
  }

  // G. Sidecar round-trip through the real preload IPC boundary:
  // saveDocument -> files on disk -> editorLoadSidecar -> exact properties.
  try {
    const ipc = new BrowserWindow({
      show: false,
      webPreferences: { preload: preloadPath(), contextIsolation: true },
    });
    await ipc.loadURL("data:text/html;charset=utf-8,sidecar");
    const call = (expr: string) => ipc.webContents.executeJavaScript(expr, true) as Promise<unknown>;
    const toDataUrl = (p: string) => `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
    const shapes = [
      { id: "r1", tool: "rectangle", x1: 10, y1: 20, x2: 110, y2: 120, color: "#f73833", stroke: 4, rotation: 0.5 },
      { id: "a1", tool: "arrow", x1: 0, y1: 0, x2: 50, y2: 60, color: "#2e7aff", stroke: 3 },
      { id: "t1", tool: "text", x1: 5, y1: 5, x2: 5, y2: 5, color: "#111111", stroke: 4, text: "hi", fontSize: 28 },
      { id: "f1", tool: "freehand", x1: 0, y1: 0, x2: 9, y2: 9, color: "#ffffff", stroke: 2, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
      { id: "n1", tool: "numberedCircle", x1: 9, y1: 9, x2: 9, y2: 9, color: "#000000", stroke: 4, counter: 7 },
      { id: "b1", tool: "blur", x1: 1, y1: 1, x2: 9, y2: 9, color: "#000000", stroke: 4, redactionStrength: 0.85 },
    ];
    const background = {
      style: { kind: "solid", rgb: [1, 2, 3] },
      padding: 0.1, cornerRadius: 0.01, shadowStrength: 0.2, aspectRatio: "16:9",
      border: { enabled: true, color: "#ffffff", thickness: 0.02, opacity: 0.9 },
      camera: { panX: 0, panY: 0.1, tiltXDegrees: 0, tiltYDegrees: 12, rotationXDegrees: 0, rotationYDegrees: 0, rollDegrees: 0, fieldOfViewDegrees: 30, zoom: 1.2 },
      progressiveBlur: { isEnabled: true, edgeMode: "bleed", mode: "directional", strength: 25, falloff: 0.4, focusSize: 0.3, focusPosition: { x: 0.4, y: 0.6 }, directionDegrees: 90 },
      watermark: { text: "T", density: 5, fontSize: 40, rotationDegrees: 30, opacity: 0.2, color: "#ffffff" },
    };
    const payload = {
      dataUrl: toDataUrl(path.join(TMP, "smart-test.png")),
      baseDataUrl: toDataUrl(path.join(TMP, "solid-src.png")),
      doc: { shapes, background, canvas: { w: 1200, h: 420 }, crop: { x: 5, y: 5, w: 600, h: 400 } },
    };
    const saved = (await call(`window.reflecto.saveDocument(${JSON.stringify(payload).replace(/</g, "\\u003c")})`)) as {
      dest: string; sidecarPath: string; basePath: string;
    };
    const filesOk =
      fs.existsSync(saved.dest) && fs.statSync(saved.dest).size > 1024 &&
      fs.existsSync(saved.sidecarPath) && fs.existsSync(saved.basePath);
    const sidecarJson = JSON.parse(fs.readFileSync(saved.sidecarPath, "utf8")) as { version: number };
    const loaded = (await call(`window.reflecto.editorLoadSidecar(${JSON.stringify(saved.dest)})`)) as {
      doc: {
        version: number;
        shapes: typeof shapes;
        background: typeof background;
        canvas: { w: number; h: number };
        crop: { x: number; y: number; w: number; h: number } | null;
      };
      basePath: string | null;
    } | null;
    const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const checks = {
      filesOk,
      versionOk: sidecarJson.version === 1 && loaded?.doc.version === 1,
      baseResolved: loaded?.basePath === saved.basePath,
      shapesExact: eq(loaded?.doc.shapes, shapes),
      bgStyle: eq(loaded?.doc.background.style, background.style),
      bgPadding: loaded?.doc.background.padding === 0.1,
      camTiltY: loaded?.doc.background.camera.tiltYDegrees === 12,
      camFov: loaded?.doc.background.camera.fieldOfViewDegrees === 30,
      camZoom: loaded?.doc.background.camera.zoom === 1.2,
      blurStrength: loaded?.doc.background.progressiveBlur.strength === 25,
      blurMode: loaded?.doc.background.progressiveBlur.mode === "directional",
      blurEdge: loaded?.doc.background.progressiveBlur.edgeMode === "bleed",
      wmText: loaded?.doc.background.watermark.text === "T",
      wmOpacity: loaded?.doc.background.watermark.opacity === 0.2,
      borderThick: loaded?.doc.background.border.thickness === 0.02,
      canvasExact: eq(loaded?.doc.canvas, { w: 1200, h: 420 }),
      cropExact: eq(loaded?.doc.crop, { x: 5, y: 5, w: 600, h: 400 }),
    };
    // Smoke: the real editor opens the saved deliverable. Because a sidecar
    // exists, it must auto-render from the untouched BASE with the restored
    // look (120x80 source + padding/camera expansion) — a canvas matching the
    // FLAT 1200px composite (or the 300px default) would mean auto-detect
    // failed. 188px is the exact base+look fingerprint for this payload.
    openAnnotateEditor(saved.dest);
    let editorCanvasW = 0;
    for (let i = 0; i < 100; i++) {
      await sleep(200);
      const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === "Reflecto Editor");
      if (win) {
        try {
          editorCanvasW = (await win.webContents.executeJavaScript(
            "[...document.querySelectorAll('canvas')].length > 0 ? document.querySelector('canvas').width : 0",
            true,
          )) as number;
          if (editorCanvasW > 0 && editorCanvasW !== 300) break;
        } catch { /* not ready */ }
      }
    }
    BrowserWindow.getAllWindows()
      .find((w) => w.getTitle() === "Reflecto Editor")
      ?.destroy();
    ipc.destroy();
    report.sidecarRoundTrip = {
      dest: saved.dest,
      size: fs.existsSync(saved.dest) ? fs.statSync(saved.dest).size : 0,
      sidecarSize: fs.existsSync(saved.sidecarPath) ? fs.statSync(saved.sidecarPath).size : 0,
      baseSize: fs.existsSync(saved.basePath) ? fs.statSync(saved.basePath).size : 0,
      editorCanvasW,
      ...checks,
      editorOpens: editorCanvasW > 0,
      editorRendersFromBase: editorCanvasW > 0 && editorCanvasW !== 300 && editorCanvasW < 1200,
      ok: false,
    };
    const g = report.sidecarRoundTrip as Record<string, unknown>;
    g.ok = Object.values(checks).every(Boolean) && (g.editorRendersFromBase as boolean);
  } catch (err) {
    report.sidecarRoundTrip = { error: err instanceof Error ? err.stack || err.message : String(err) };
  }

  // H. Studio matrix: multi-clip + timed masks + HEVC/480p, audio-only,
  // and replacement-audio exports (direct engine calls with explicit dests).
  try {
    const recDir = path.join(app.getPath("userData"), "recordings");
    const studioSrc = path.join(recDir, "e2e-studio-src.mkv");
    execFileSync(
      resolveFfmpeg(),
      ["-y", "-f", "lavfi", "-i", "testsrc=s=640x360:r=30:d=6", "-f", "lavfi", "-i", "sine=frequency=440:d=6",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2",
        "-shortest", studioSrc],
      { stdio: "ignore", windowsHide: true },
    );
    const replSrc = path.join(recDir, "e2e-studio-repl.m4a");
    execFileSync(
      resolveFfmpeg(),
      ["-y", "-f", "lavfi", "-i", "sine=frequency=880:d=10", "-c:a", "aac", "-ar", "48000", "-ac", "2", replSrc],
      { stdio: "ignore", windowsHide: true },
    );
    const clips = [
      { sourceStart: 0, sourceEnd: 2, speed: 1 },
      { sourceStart: 2, sourceEnd: 4, speed: 2 },
      { sourceStart: 4, sourceEnd: 6, speed: 0.5 },
    ];
    const combinedDest = path.join(recDir, "e2e-studio-combined.mp4");
    await exportEditedVideo({
      src: studioSrc,
      dest: combinedDest,
      trimStart: 0,
      trimEnd: 6,
      clips,
      crop: null,
      masks: [
        { type: "blur", x: 60, y: 60, width: 200, height: 120, coverage: "crop", start: 1, end: 3, amount: 30 },
        { type: "pixelate", x: 0, y: 0, width: 10, height: 10, coverage: "full", start: 5, end: 7, amount: 24 },
      ],
      fps: 30,
      crf: 28,
      codec: "hevc",
      resolution: "480",
      container: "mp4",
      quality: "low",
    });
    const combinedProbe = await probe(combinedDest);
    const m4aDest = path.join(recDir, "e2e-studio-audio.m4a");
    await exportEditedVideo({
      src: studioSrc, dest: m4aDest, trimStart: 0, trimEnd: 6, clips,
      crop: null, masks: [], fps: 30, crf: 26, audioOnly: "m4a",
    });
    const m4aProbe = await probe(m4aDest);
    const wavDest = path.join(recDir, "e2e-studio-audio.wav");
    await exportEditedVideo({
      src: studioSrc, dest: wavDest, trimStart: 0, trimEnd: 6, clips,
      crop: null, masks: [], fps: 30, crf: 26, audioOnly: "wav",
    });
    const wavProbe = await probe(wavDest);
    const replDest = path.join(recDir, "e2e-studio-repl.mp4");
    await exportEditedVideo({
      src: studioSrc, dest: replDest, trimStart: 0, trimEnd: 6, clips,
      crop: null, masks: [], fps: 30, crf: 26, replacementAudio: replSrc,
    });
    const replProbe = await probe(replDest);
    const dur = (p: string) => {
      const m = p.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
    };
    const stream = (p: string, kind: string) =>
      p.split(/\r?\n/).find((l) => l.includes("Stream #") && l.includes(`${kind}:`))?.trim() ?? null;
    const combinedVideo = stream(combinedProbe, "Video") ?? "";
    const combinedAudio = stream(combinedProbe, "Audio") ?? "";
    report.studioMatrix = {
      combined: {
        path: combinedDest,
        size: fs.existsSync(combinedDest) ? fs.statSync(combinedDest).size : 0,
        video: combinedVideo,
        audio: combinedAudio,
        duration: Math.round(dur(combinedProbe) * 100) / 100,
        isHevc: /hevc/i.test(combinedVideo),
        is480p: /854x480/.test(combinedVideo),
        durationOk: Math.abs(dur(combinedProbe) - 7) < 0.4,
      },
      m4a: {
        size: fs.existsSync(m4aDest) ? fs.statSync(m4aDest).size : 0,
        audio: stream(m4aProbe, "Audio"),
        duration: Math.round(dur(m4aProbe) * 100) / 100,
        isAac: /aac/i.test(stream(m4aProbe, "Audio") ?? ""),
        durationOk: Math.abs(dur(m4aProbe) - 7) < 0.4,
      },
      wav: {
        size: fs.existsSync(wavDest) ? fs.statSync(wavDest).size : 0,
        audio: stream(wavProbe, "Audio"),
        duration: Math.round(dur(wavProbe) * 100) / 100,
        isPcm: /pcm_s16le/i.test(stream(wavProbe, "Audio") ?? ""),
        durationOk: Math.abs(dur(wavProbe) - 7) < 0.4,
      },
      replacement: {
        size: fs.existsSync(replDest) ? fs.statSync(replDest).size : 0,
        video: stream(replProbe, "Video"),
        audio: stream(replProbe, "Audio"),
        duration: Math.round(dur(replProbe) * 100) / 100,
        durationOk: Math.abs(dur(replProbe) - 7) < 0.4,
      },
      ok: false,
    };
    interface StudioSection {
      size?: number; isHevc?: boolean; is480p?: boolean; durationOk?: boolean;
      isAac?: boolean; isPcm?: boolean; audio?: string | null; video?: string | null;
    }
    const st = report.studioMatrix as { combined?: StudioSection; m4a?: StudioSection; wav?: StudioSection; replacement?: StudioSection; ok?: boolean };
    st.ok = Boolean(
      st.combined?.size && st.combined.size > 1024 && st.combined.isHevc && st.combined.is480p && st.combined.durationOk && st.combined.audio &&
      st.m4a?.size && st.m4a.size > 1024 && st.m4a.isAac && st.m4a.durationOk &&
      st.wav?.size && st.wav.size > 1024 && st.wav.isPcm && st.wav.durationOk &&
      st.replacement?.size && st.replacement.size > 1024 && st.replacement.video && st.replacement.audio && st.replacement.durationOk,
    );
  } catch (err) {
    report.studioMatrix = { error: err instanceof Error ? err.stack || err.message : String(err) };
  }
  const s = report.solidLook as { solidOk?: boolean; distinctFromGradient?: boolean };
  const r = report.rotation as { ok?: boolean };
  const m = report.smartRedact as { ok?: boolean };
  const u = report.editorUI as { ok?: boolean };
  const l = report.look2b as { pass?: boolean };
  const d = report.sidecarRoundTrip as { ok?: boolean };
  const st2 = report.studioMatrix as { ok?: boolean };
  report.ok = Boolean(s?.solidOk && s?.distinctFromGradient && r?.ok && m?.ok && u?.ok && l?.pass && d?.ok && st2?.ok);
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log("[Reflecto:editor-e2e]", reportPath);
  console.log("[Reflecto:editor-e2e]", JSON.stringify(report, null, 2));
  return reportPath;
}
