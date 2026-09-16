import { app, desktopCapturer, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  startSession,
  pauseSession,
  resumeSession,
  stopSession,
  refreshMediaDevices,
  lastCaptureWorkerInfo,
  lastCameraSidecar,
  type RecordingOptions,
} from "./engine";
import { exportEditedVideo } from "./exportVideo";
import { resolveFfmpeg } from "./ffmpeg";

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
  const line = probeText.split(/\r?\n/).find((l) => l.includes(`Stream #`) && l.includes(`${kind}:`));
  return line?.trim() ?? null;
}

async function recordClip(options: RecordingOptions, ms: number) {
  await startSession(options);
  await sleep(ms);
  const out = await stopSession(true);
  return {
    path: out,
    size: out && fs.existsSync(out) ? fs.statSync(out).size : 0,
    worker: lastCaptureWorkerInfo(),
    probe: out ? await probe(out) : "",
  };
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

    const masked = path.join(app.getPath("userData"), "recordings", "e2e-masked.mp4");
    const exported = await exportEditedVideo({
      src: out,
      dest: masked,
      trimStart: 0,
      trimEnd: 1.8,
      crop: null,
      masks: [
        { type: "blur", x: 20, y: 20, width: 160, height: 120 },
        { type: "pixelate", x: 200, y: 40, width: 120, height: 80 },
      ],
      fps: 30,
      crf: 23,
    });
    report.maskedPath = exported;
    report.maskedSize = fs.existsSync(exported) ? fs.statSync(exported).size : 0;
    report.maskedProbe = await probe(exported);
    report.maskedDurationLine = String(report.maskedProbe).split(/\r?\n/).find((l) => l.includes("Duration:"));

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

    const windows = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 16, height: 16 } });
    const winSrc = windows.find((w) => w.name && !/reflecto/i.test(w.name));
    report.windowCandidates = windows.slice(0, 8).map((w) => ({ id: w.id, name: w.name }));
    if (winSrc) {
      try {
        const winClip = await recordClip({
          source: { type: "window", sourceId: winSrc.id, title: winSrc.name },
          systemAudio: false,
          fps: 24,
        }, 1100);
        report.window = {
          sourceId: winSrc.id,
          title: winSrc.name,
          path: winClip.path,
          size: winClip.size,
          worker: winClip.worker,
          videoStream: extractStreamLine(winClip.probe, "Video"),
        };
      } catch (err) {
        report.window = { sourceId: winSrc.id, title: winSrc.name, error: String(err) };
      }
    } else {
      report.window = { skipped: "no window sources" };
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
        }, 1200);
        report.camera = {
          id: camId,
          label: cam?.label || "default",
          path: camClip.path,
          size: camClip.size,
          worker: camClip.worker,
          sidecar: lastCameraSidecar(),
          sidecarProbe: lastCameraSidecar()?.path ? await probe(lastCameraSidecar()!.path) : null,
          videoStream: extractStreamLine(camClip.probe, "Video"),
        };
      } catch (err) {
        report.camera = { id: camId, error: String(err), sidecar: lastCameraSidecar() };
      }
    } else {
      report.camera = { skipped: "no videoinput device enumerated" };
    }

    const scale = primary.scaleFactor;
    const expectedW = even(areaRect.width * scale);
    const expectedH = even(areaRect.height * scale);
    const areaOk = Number((report.area as { size?: number }).size) > 1024;
    const areaWorker = (report.area as { worker?: { width?: number; height?: number } }).worker;
    const areaSizeOk = areaWorker?.width === expectedW && areaWorker?.height === expectedH;
    report.expectedAreaPixels = { width: expectedW, height: expectedH, scaleFactor: scale };
    report.ok = Number(report.size) > 1024 && Number(report.maskedSize) > 1024 && areaOk && Boolean(areaSizeOk);
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
