import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { HistoryStore } from "../history/store";
import { saveToDefaultLocation } from "./fileActions";

/**
 * Port of Sources/Preview/DeckStaging.swift.
 * Private working images + untouched raw companions for capture cards.
 */

const savedCopies = new Map<string, string>();
const retainedCopies = new Map<string, string>();

export const DeckStaging = {
  get directory(): string {
    return path.join(app.getPath("userData"), "deck");
  },

  isStaged(filePath: string): boolean {
    const dir = path.normalize(this.directory) + path.sep;
    return path.normalize(filePath).startsWith(dir);
  },

  rawURL(stagedURL: string): string {
    const parsed = path.parse(stagedURL);
    return path.join(parsed.dir, `${parsed.name}.raw.png`);
  },

  prepareDirectory(): void {
    fs.mkdirSync(this.directory, { recursive: true });
  },

  savedURL(filePath: string): string | undefined {
    return savedCopies.get(filePath);
  },

  /** Keep editable source + preview inside Reflecto for Edit / Pin / Share / drag-out. */
  retain(filePath: string): string {
    if (!this.isStaged(filePath)) return filePath;
    const cached = retainedCopies.get(filePath);
    if (cached) return cached;

    const record = HistoryStore.shared.importCapture(this.rawURL(filePath), false, "screenshot");
    if (!record) return filePath;
    const raw = HistoryStore.shared.urlForRecord(record);
    const ext = path.extname(filePath).replace(".", "") || "png";
    const preview = `${raw.replace(path.extname(raw), "")}.preview.${ext}`;
    try {
      fs.copyFileSync(filePath, preview);
    } catch {
      HistoryStore.shared.deleteRecord(record);
      return filePath;
    }
    HistoryStore.shared.setBeautifiedPath(preview, record.id);
    retainedCopies.set(filePath, preview);
    return preview;
  },

  /** Promote staged capture into the user save folder + library. */
  promote(filePath: string): string {
    if (!this.isStaged(filePath)) return filePath;
    const cached = savedCopies.get(filePath);
    if (cached) return cached;

    const retained = this.retain(filePath);
    if (this.isStaged(retained)) return filePath;
    try {
      const dest = saveToDefaultLocation(filePath);
      const record = HistoryStore.shared.recordMatching(retained);
      if (record) HistoryStore.shared.setBeautifiedPath(dest, record.id);
      savedCopies.set(filePath, dest);
      retainedCopies.set(filePath, dest);
      return dest;
    } catch (err) {
      console.error("[Reflecto] Failed to save staged capture:", err);
      return filePath;
    }
  },

  discard(filePath: string): void {
    if (!this.isStaged(filePath)) return;
    savedCopies.delete(filePath);
    retainedCopies.delete(filePath);
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    try { fs.unlinkSync(this.rawURL(filePath)); } catch { /* ignore */ }
  },

  purge(): void {
    savedCopies.clear();
    retainedCopies.clear();
    try { fs.rmSync(this.directory, { recursive: true, force: true }); } catch { /* ignore */ }
  },
};
