import { app, BrowserWindow, desktopCapturer, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import {
  startSession,
  pauseSession,
  resumeSession,
  stopSession,
  refreshMediaDevices,
  lastCaptureWorkerInfo,
  lastCameraSidecar,
  lastGdiInfo,
  lastPointerLog,
  type RecordingOptions,
} from "./engine";
import { finishRecording } from "./bar";
import { HistoryStore } from "../history/store";
import { getPref, setPref } from "../preferences";
import { exportEditedVideo } from "./exportVideo";
import { resolveFfmpeg } from "./ffmpeg";
import { getWindowRect, nativeHwnd } from "../win32";

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

function extractStreamLine(probeText: string, kind: "Video" | "Audio"): string | null {
  const line = probeText.split(/\r?\n/).find((l) => l.includes("Stream #") && l.includes(`${kind}:`));
  return line?.trim() ?? null;
}

function extractDuration(probeText: string): string | null {
  const m = probeText.match(/Duration:\s*(\d+:\d+:\d+\.\d+)/);
  return m?.[1] ?? null;
}

function extractSize(probeText: string): { width: number; height: number } | null {
  const line = extractStreamLine(probeText, "Video") || "";
  const m = line.match(/(\d{2,5})x(\d{2,5})/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

async function recordClip(options: RecordingOptions, ms: number) {
  await startSession(options);
  await sleep(ms);
  const out = await stopSession(true);
  return {
    path: out,
    size: out && fs.existsSync(out) ? fs.statSync(out).size : 0,
    worker: lastCaptureWorkerInfo(),
    gdi: lastGdiInfo(),
    probe: out ? await probe(out) : "",
  };
}

function fixtureWindow(bounds: Electron.Rectangle, title: string) {
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    frame: true,
    skipTaskbar: false,
    backgroundColor: "#cc3344",
    webPreferences: { contextIsolation: true },
    title,
  });
  return win;
}

export async function runRecordingE2E(): Promise<string> {
  const reportPath = path.join(app.getPath("userData"), "recording-e2e.json");
  const report: Record<string, unknown> = { startedAt: new Date().toISOString() };
  try {
    const screens = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 16, height: 16 } });
    report.screens = screens.map((s) => ({ id: s.id, name: s.name, display_id: s.display_id }));
    if (!screens[0]) throw new Error("desktopCapturer returned no screens");

    await startSession({
      source: { type: "display", sourceId: screens[0].id },
      systemAudio: true,
      microphone: null,
      camera: null,
      fps: 30,
    });
    report.displayWorker = lastCaptureWorkerInfo();
    report.started = true;
    await sleep(1600);
    await pauseSession();
    report.paused = true;
    await sleep(400);
    await resumeSession();
    report.resumed = true;
    await sleep(900);
    const out = await stopSession(true);
    report.savedPath = out;
    if (!out || !fs.existsSync(out)) throw new Error("stopSession did not write a file");
    report.size = fs.statSync(out).size;
    report.probe = await probe(out);
    report.videoStream = extractStreamLine(String(report.probe), "Video");
    report.audioStream = extractStreamLine(String(report.probe), "Audio");

    const maskedCrop = path.join(app.getPath("userData"), "recordings", "e2e-masked-crop-2x.mp4");
    const exportedCrop = await exportEditedVideo({
      src: out,
      dest: maskedCrop,
      trimStart: 0,
      trimEnd: 1.8,
      crop: null,
      masks: [{ type: "blur", x: 20, y: 20, width: 160, height: 120, coverage: "crop" }],
      fps: 30,
      crf: 23,
      speed: 2,
    });
    report.maskedCrop2x = {
      path: exportedCrop,
      size: fs.existsSync(exportedCrop) ? fs.statSync(exportedCrop).size : 0,
      duration: extractDuration(await probe(exportedCrop)),
      video: extractStreamLine(await probe(exportedCrop), "Video"),
    };

    const maskedFull = path.join(app.getPath("userData"), "recordings", "e2e-masked-full-0.5x.mp4");
    const exportedFull = await exportEditedVideo({
      src: out,
      dest: maskedFull,
      trimStart: 0,
      trimEnd: 1.8,
      crop: null,
      masks: [{ type: "pixelate", x: 0, y: 0, width: 10, height: 10, coverage: "full" }],
      fps: 30,
      crf: 23,
      speed: 0.5,
    });
    report.maskedFull05x = {
      path: exportedFull,
      size: fs.existsSync(exportedFull) ? fs.statSync(exportedFull).size : 0,
      duration: extractDuration(await probe(exportedFull)),
      video: extractStreamLine(await probe(exportedFull), "Video"),
    };

    const primary = screen.getPrimaryDisplay();
    const areaRect = {
      x: primary.bounds.x + 80,
      y: primary.bounds.y + 80,
      width: 480,
      height: 270,
    };
    const area = await recordClip({
      source: { type: "area", rect: areaRect, displayId: primary.id, sourceId: screens[0].id },
      systemAudio: false,
      fps: 24,
    }, 1100);
    report.area = {
      requested: areaRect,
      path: area.path,
      size: area.size,
      worker: area.worker,
      videoStream: extractStreamLine(area.probe, "Video"),
    };

    const cursorOff = await recordClip({
      source: { type: "display", sourceId: screens[0].id },
      showCursor: false,
      cursorStyle: "hidden",
      fps: 24,
    }, 1400);
    report.cursorHidden = {
      path: cursorOff.path,
      size: cursorOff.size,
      gdiArgs: cursorOff.gdi?.args,
      duration: extractDuration(cursorOff.probe),
      video: extractStreamLine(cursorOff.probe, "Video"),
      drawMouse: cursorOff.gdi?.args.includes("0") && cursorOff.gdi.args.includes("-draw_mouse"),
    };

    const cursorOn = await recordClip({
      source: { type: "display", sourceId: screens[0].id },
      showCursor: true,
      cursorStyle: "recorded",
      fps: 24,
    }, 1200);
    report.cursorRecorded = {
      path: cursorOn.path,
      size: cursorOn.size,
      duration: extractDuration(cursorOn.probe),
      engine: cursorOn.gdi ? "gdigrab" : "chromium",
      video: extractStreamLine(cursorOn.probe, "Video"),
    };

    try {
    const normal = fixtureWindow({ x: 120, y: 80, width: 640, height: 400 }, "Reflecto E2E Normal");
    await normal.loadURL("data:text/html,<body style='background:#c33;margin:0'><h1>normal</h1></body>");
    normal.show();
    await sleep(400);
    const normalHwnd = nativeHwnd(normal);
    const normalExpected = getWindowRect(normalHwnd);
    const normalClip = await recordClip({
      source: { type: "window", sourceId: `window:${normalHwnd}:0`, title: "Reflecto E2E Normal" },
      showCursor: false,
      fps: 24,
    }, 1300);
    report.windowNormal = {
      hwnd: normalHwnd,
      expected: normalExpected,
      gdiExpected: lastGdiInfo()?.expected,
      path: normalClip.path,
      size: normalClip.size,
      output: extractSize(normalClip.probe),
      video: extractStreamLine(normalClip.probe, "Video"),
    };

    const maxWin = fixtureWindow({ x: 80, y: 40, width: 700, height: 500 }, "Reflecto E2E Max");
    await maxWin.loadURL("data:text/html,<body style='background:#36c;margin:0'><h1>max</h1></body>");
    maxWin.show();
    maxWin.maximize();
    await sleep(500);
    const maxHwnd = nativeHwnd(maxWin);
    const maxExpected = getWindowRect(maxHwnd);
    const maxClip = await recordClip({
      source: { type: "window", sourceId: `window:${maxHwnd}:0`, title: "Reflecto E2E Max" },
      showCursor: false,
      fps: 24,
    }, 1300);
    report.windowMaximized = {
      hwnd: maxHwnd,
      expected: maxExpected,
      output: extractSize(maxClip.probe),
      path: maxClip.path,
      size: maxClip.size,
      video: extractStreamLine(maxClip.probe, "Video"),
    };

    const occ = fixtureWindow({ x: 160, y: 120, width: 520, height: 360 }, "Reflecto E2E Occluded");
    await occ.loadURL("data:text/html,<body style='background:#3c6;margin:0'><h1>occluded</h1></body>");
    occ.show();
    await sleep(300);
    const cover = fixtureWindow({ x: 180, y: 140, width: 480, height: 320 }, "Reflecto E2E Cover");
    await cover.loadURL("data:text/html,<body style='background:#111;margin:0'><h1>cover</h1></body>");
    cover.setAlwaysOnTop(true);
    cover.show();
    await sleep(300);
    const occHwnd = nativeHwnd(occ);
    const occExpected = getWindowRect(occHwnd);
    const occClip = await recordClip({
      source: { type: "window", sourceId: `window:${occHwnd}:0`, title: "Reflecto E2E Occluded" },
      showCursor: false,
      fps: 24,
    }, 1300);
    report.windowOccluded = {
      hwnd: occHwnd,
      expected: occExpected,
      output: extractSize(occClip.probe),
      path: occClip.path,
      size: occClip.size,
      video: extractStreamLine(occClip.probe, "Video"),
      note: "gdigrab desktop-crop records pixels on screen, so an occluder is visible. Windows has no ScreenCaptureKit-style independent occluded framebuffer.",
    };
    cover.destroy();
    occ.destroy();
    maxWin.destroy();
    normal.destroy();
    } catch (err) {
      report.windowError = err instanceof Error ? err.stack || err.message : String(err);
    }

    const devices = await refreshMediaDevices();
    report.devices = devices;
    const mic = devices.find((d) => d.kind === "audio");
    const cam = devices.find((d) => d.kind === "video");
    const { listDshowDevices, even } = await import("./ffmpeg");
    const dshow = await listDshowDevices();
    report.dshowDevices = dshow;
    const micId = mic?.id || (dshow.some((d) => d.kind === "audio") ? "default" : null);
    const camId = cam?.id || (dshow.some((d) => d.kind === "video") ? "default" : null);
    if (micId) {
      try {
        const micClip = await recordClip({
          source: { type: "display", sourceId: screens[0].id },
          systemAudio: false,
          microphone: micId,
          fps: 24,
        }, 1100);
        report.microphone = {
          id: micId,
          label: mic?.label || "default",
          path: micClip.path,
          size: micClip.size,
          worker: micClip.worker,
          audioStream: extractStreamLine(micClip.probe, "Audio"),
        };
      } catch (err) {
        report.microphone = { id: micId, error: String(err) };
      }
    } else {
      report.microphone = { skipped: "no audioinput device enumerated" };
    }
    if (camId) {
      try {
        const camClip = await recordClip({
          source: { type: "display", sourceId: screens[0].id },
          systemAudio: false,
          camera: camId,
          fps: 24,
        }, 3200);
        const side = lastCameraSidecar();
        const sideProbe = side?.path ? await probe(side.path) : "";
        report.camera = {
          id: camId,
          label: cam?.label || "default",
          path: camClip.path,
          size: camClip.size,
          worker: camClip.worker,
          sidecar: side,
          sidecarDuration: extractDuration(sideProbe),
          sidecarVideo: extractStreamLine(sideProbe, "Video"),
          sidecarProbe: sideProbe,
        };
      } catch (err) {
        report.camera = { id: camId, error: String(err), sidecar: lastCameraSidecar() };
      }
    } else {
      report.camera = { skipped: "no videoinput device enumerated" };
    }

    // Batch-1 close-out: dot-cursor position + camera via production finish path.
    try {
      const moveMouse = (x: number, y: number) => {
        execFileSync(
          "powershell.exe",
          ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x},${y})`],
          { windowsHide: true, timeout: 15000 },
        );
      };
      const P1 = { x: 600, y: 400 };
      const P2 = { x: 900, y: 550 };
      await startSession({
        source: { type: "display", sourceId: screens[0].id },
        systemAudio: false,
        showCursor: true,
        cursorStyle: "dot",
        fps: 24,
      });
      moveMouse(P1.x, P1.y);
      await sleep(900);
      moveMouse(P2.x, P2.y);
      await sleep(900);
      const samples = lastPointerLog();
      const dotOut = await stopSession(true);
      const dotProbe = dotOut ? await probe(dotOut) : "";
      const near = (p: { x: number; y: number }) =>
        samples.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < 60);
      report.dotCursor = {
        path: dotOut,
        size: dotOut && fs.existsSync(dotOut) ? fs.statSync(dotOut).size : 0,
        video: extractStreamLine(dotProbe, "Video"),
        duration: extractDuration(dotProbe),
        engine: lastGdiInfo() ? "gdigrab" : "chromium",
        gdiArgs: lastGdiInfo()?.args,
        sampleCount: samples.length,
        commanded: [P1, P2],
        sawP1: near(P1),
        sawP2: near(P2),
        scaleFactor: primary.scaleFactor,
      };

      const prevEditor = getPref("openEditorAfterRecording");
      setPref("openEditorAfterRecording", false);
      const histBefore = HistoryStore.shared.records.length;
      if (camId) {
        await startSession({
          source: { type: "display", sourceId: screens[0].id },
          systemAudio: false,
          camera: camId,
          fps: 24,
        });
        await sleep(2500);
        await finishRecording(true);
        await sleep(500);
        const histAfter = HistoryStore.shared.records;
        const fresh = histAfter.slice(0, Math.max(0, histAfter.length - histBefore));
        const side2 = lastCameraSidecar();
        const sideProbe2 = side2?.path ? await probe(side2.path) : "";
        report.cameraToastPath = {
          historyDelta: histAfter.length - histBefore,
          fresh: fresh.map((r) => ({ filename: r.filename, kind: r.kind })),
          sidecar: side2,
          sidecarDuration: extractDuration(sideProbe2),
          sidecarVideo: extractStreamLine(sideProbe2, "Video"),
        };
      } else {
        report.cameraToastPath = { skipped: "no camera" };
      }
      setPref("openEditorAfterRecording", prevEditor);
      const dc = report.dotCursor as { sawP1?: boolean; sawP2?: boolean; size?: number };
      const ct = report.cameraToastPath as { historyDelta?: number };
      report.batch1Ok =
        Boolean(dc?.sawP1 && dc?.sawP2) &&
        Number(dc?.size) > 1024 &&
        Number(ct?.historyDelta) >= 2;
    } catch (err) {
      report.batch1Error = err instanceof Error ? err.stack || err.message : String(err);
    }

    const scale = primary.scaleFactor;
    const expectedW = even(areaRect.width * scale);
    const expectedH = even(areaRect.height * scale);
    const areaOk = Number((report.area as { size?: number }).size) > 1024;
    const areaWorker = (report.area as { worker?: { width?: number; height?: number } }).worker;
    const areaSizeOk = areaWorker?.width === expectedW && areaWorker?.height === expectedH;
    const side = (report.camera as { sidecar?: { size?: number }; sidecarDuration?: string | null }) || {};
    report.expectedAreaPixels = { width: expectedW, height: expectedH, scaleFactor: scale };
    report.ok = Number(report.size) > 1024
      && Number((report.maskedCrop2x as { size?: number }).size) > 1024
      && Number((report.maskedFull05x as { size?: number }).size) > 1024
      && areaOk
      && Boolean(areaSizeOk)
      && Number(side.sidecar?.size) > 2048
      && Boolean(side.sidecarDuration && side.sidecarDuration !== "00:00:00.00");
    report.areaSizeOk = areaSizeOk;
  } catch (err) {
    report.ok = false;
    report.error = err instanceof Error ? err.stack || err.message : String(err);
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log("[Reflecto:e2e]", reportPath);
  console.log("[Reflecto:e2e]", JSON.stringify(report, null, 2));
  return reportPath;
}
