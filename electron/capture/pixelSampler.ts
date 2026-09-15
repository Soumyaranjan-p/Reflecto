import { screen, desktopCapturer, nativeImage } from "electron";

/**
 * Port of Sources/Capture/ColorPickerOverlay.swift (pixel sampling part).
 * PLATFORM GAP: macOS had NSReadPixel-style direct pixel access via CGWindowList;
 * on Windows Electron has no per-pixel live API, so we grab a fresh 1×1
 * desktopCapturer frame and sample it. Latency ~50–150ms vs. instant on macOS.
 * The loupe UI in src/overlay/ColorPickerOverlay.tsx reuses this.
 */
export async function pickColorAt(): Promise<string | null> {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: display.size.width, height: display.size.height },
  });
  const match = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!match) return null;
  const img = nativeImage.createFromDataURL(match.thumbnail.toDataURL());
  const localX = Math.round((cursor.x - display.bounds.x) * display.scaleFactor);
  const localY = Math.round((cursor.y - display.bounds.y) * display.scaleFactor);
  const size = img.getSize();
  const clampedX = Math.min(Math.max(localX, 0), size.width - 1);
  const clampedY = Math.min(Math.max(localY, 0), size.height - 1);
  const [r, g, b] = readPixel(img, clampedX, clampedY);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function readPixel(img: Electron.NativeImage, x: number, y: number): [number, number, number] {
  const buf = img.toBitmap();
  const size = img.getSize();
  const idx = (y * size.width + x) * 4;
  return [buf[idx + 2], buf[idx + 1], buf[idx]]; // BGRA → RGB
}
