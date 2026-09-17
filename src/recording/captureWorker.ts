/**
 * Chromium desktop capture worker — Windows equivalent of ScreenCaptureKit.
 * Pause/resume uses MediaRecorder.pause (real, not a UI timer).
 * System audio uses desktop chromeMediaSource audio (Windows loopback).
 * Camera is NOT composited here in production: engine.ts always sends
 * cameraId:null and records camera via a separate DirectShow sidecar
 * (BetterShot camera.mov equivalent). The bubble draw path below only runs
 * when a real cameraId is passed (currently never) — kept for a future
 * true-PiP option, not as implied behavior.
 */

export interface WorkerStartConfig {
  sourceId: string;
  crop?: { x: number; y: number; width: number; height: number } | null;
  scaleFactor?: number;
  microphoneId?: string | null;
  cameraId?: string | null;
  systemAudio: boolean;
  fps: number;
}

type DesktopConstraints = MediaStreamConstraints & {
  audio?: boolean | { mandatory: Record<string, string | number | boolean> };
  video?: { mandatory: Record<string, string | number | boolean> };
};

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let mixedStream: MediaStream | null = null;
let raf = 0;
let audioCtx: AudioContext | null = null;

const api = window.reflecto;

api.onBus("recording:worker-start", (payload) => {
  void begin(payload as WorkerStartConfig);
});
api.onBus("recording:worker-pause", () => {
  if (recorder?.state === "recording") recorder.pause();
});
api.onBus("recording:worker-resume", () => {
  if (recorder?.state === "paused") recorder.resume();
});
api.onBus("recording:worker-stop", () => {
  void finish();
});
api.onBus("recording:worker-list-devices", () => {
  void listDevices();
});

async function listDevices() {
  try {
    try {
      const grant = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      grant.getTracks().forEach((t) => t.stop());
    } catch {
      try {
        const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
        audio.getTracks().forEach((t) => t.stop());
      } catch { /* no mic */ }
      try {
        const video = await navigator.mediaDevices.getUserMedia({ video: true });
        video.getTracks().forEach((t) => t.stop());
      } catch { /* no camera */ }
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    api.recordingWorkerEvent("devices", {
      devices: devices
        .filter((d) => d.kind === "audioinput" || d.kind === "videoinput")
        .map((d) => ({
          id: d.deviceId,
          label: d.label || `${d.kind} ${d.deviceId.slice(0, 8)}`,
          kind: d.kind === "audioinput" ? "audio" : "video",
        })),
    });
  } catch (err) {
    api.recordingWorkerEvent("devices", { devices: [], error: String(err) });
  }
}

async function begin(config: WorkerStartConfig) {
  try {
    stopTracks();
    const desktop: DesktopConstraints = {
      audio: config.systemAudio
        ? {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: config.sourceId,
            },
          }
        : false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: config.sourceId,
          minFrameRate: config.fps,
          maxFrameRate: config.fps,
        },
      },
    };
    let screenStream: MediaStream;
    try {
      screenStream = await navigator.mediaDevices.getUserMedia(desktop);
    } catch (err) {
      if (!config.systemAudio) throw err;
      desktop.audio = false;
      screenStream = await navigator.mediaDevices.getUserMedia(desktop);
      api.recordingWorkerEvent("warn", {
        message: `System audio loopback failed (${err instanceof Error ? err.message : String(err)}); continuing video-only`,
      });
    }
    const screenVideo = document.getElementById("screen") as HTMLVideoElement;
    screenVideo.srcObject = screenStream;
    await screenVideo.play();
    await waitForSize(screenVideo);

    const crop = config.crop;
    const scale = config.scaleFactor || 1;
    const canvas = document.getElementById("stage") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    let sx = 0, sy = 0, sw = screenVideo.videoWidth, sh = screenVideo.videoHeight;
    if (crop && crop.width > 2 && crop.height > 2) {
      sx = Math.max(0, Math.round(crop.x * scale));
      sy = Math.max(0, Math.round(crop.y * scale));
      sw = Math.min(screenVideo.videoWidth - sx, Math.round(crop.width * scale));
      sh = Math.min(screenVideo.videoHeight - sy, Math.round(crop.height * scale));
      sw = sw - (sw % 2);
      sh = sh - (sh % 2);
    }
    canvas.width = Math.max(2, sw);
    canvas.height = Math.max(2, sh);

    let camVideo: HTMLVideoElement | null = null;
    if (config.cameraId) {
      try {
        const camStream = await Promise.race([
          navigator.mediaDevices.getUserMedia({
            video: config.cameraId === "default"
              ? { width: { ideal: 640 } }
              : { deviceId: { ideal: config.cameraId }, width: { ideal: 640 } },
            audio: false,
          }),
          new Promise<MediaStream>((_, reject) => {
            window.setTimeout(() => reject(new Error("camera getUserMedia timed out")), 6000);
          }),
        ]);
        camVideo = document.getElementById("camera") as HTMLVideoElement;
        camVideo.srcObject = camStream;
        await camVideo.play();
      } catch (err) {
        api.recordingWorkerEvent("warn", {
          message: `Camera overlay failed (${err instanceof Error ? err.message : String(err)}); recording without camera`,
        });
        camVideo = null;
      }
    }

    const draw = () => {
      ctx.drawImage(screenVideo, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      if (camVideo && camVideo.videoWidth) {
        const bubble = Math.round(Math.min(canvas.width, canvas.height) * 0.26);
        const pad = 24;
        const x = canvas.width - bubble - pad;
        const y = canvas.height - bubble - pad;
        ctx.save();
        ctx.beginPath();
        rounded(ctx, x, y, bubble, bubble, bubble * 0.25);
        ctx.clip();
        ctx.drawImage(camVideo, x, y, bubble, bubble);
        ctx.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    const canvasStream = canvas.captureStream(config.fps);
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];

    audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    let hasAudio = false;
    const screenAudio = screenStream.getAudioTracks();
    if (screenAudio.length) {
      audioCtx.createMediaStreamSource(new MediaStream(screenAudio)).connect(dest);
      hasAudio = true;
    }
    if (config.microphoneId) {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: config.microphoneId === "default"
          ? { echoCancellation: true }
          : { deviceId: { exact: config.microphoneId }, echoCancellation: true },
        video: false,
      });
      audioCtx.createMediaStreamSource(micStream).connect(dest);
      hasAudio = true;
    }
    if (hasAudio) tracks.push(...dest.stream.getAudioTracks());

    mixedStream = new MediaStream(tracks);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? "video/webm;codecs=vp8,opus"
        : "video/webm";
    chunks = [];
    recorder = new MediaRecorder(mixedStream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.start(500);
    api.recordingWorkerEvent("started", {
      mime,
      width: canvas.width,
      height: canvas.height,
      hasAudio,
      hasCamera: Boolean(camVideo),
    });
  } catch (err) {
    api.recordingWorkerEvent("error", { message: err instanceof Error ? err.message : String(err) });
  }
}

async function finish() {
  const rec = recorder;
  if (!rec || rec.state === "inactive") {
    api.recordingWorkerEvent("stopped", { size: 0 });
    stopTracks();
    return;
  }
  const blob = await new Promise<Blob>((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || "video/webm" }));
    rec.stop();
  });
  stopTracks();
  const buf = new Uint8Array(await blob.arrayBuffer());
  await api.recordingSaveBlob(buf);
  api.recordingWorkerEvent("stopped", { size: buf.byteLength });
}

function stopTracks() {
  cancelAnimationFrame(raf);
  recorder = null;
  for (const id of ["screen", "camera"] as const) {
    const el = document.getElementById(id) as HTMLVideoElement | null;
    const stream = el?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (el) el.srcObject = null;
  }
  mixedStream?.getTracks().forEach((t) => t.stop());
  mixedStream = null;
  void audioCtx?.close();
  audioCtx = null;
}

function waitForSize(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth) return Promise.resolve();
  return new Promise((resolve) => {
    const t = window.setInterval(() => {
      if (video.videoWidth) {
        clearInterval(t);
        resolve();
      }
    }, 50);
    window.setTimeout(() => {
      clearInterval(t);
      resolve();
    }, 4000);
  });
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
