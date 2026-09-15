import { app, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Port of Sources/History/HistoryStore.swift + CaptureRecord.swift.
 * Persists capture history as JSON under Application Support/Reflecto.
 */

export type CaptureKind = "screenshot" | "recording";

export interface CaptureRecord {
  id: string;
  createdAt: string;
  filename: string;
  pixelWidth: number;
  pixelHeight: number;
  kind: CaptureKind;
  hasAnnotations: boolean;
  beautifiedPath?: string | null;
  sourcePath?: string | null;
  shareURL?: string | null;
}

const MAX_RETENTION = 500;

export class HistoryStore {
  private static _instance: HistoryStore | null = null;
  static get shared(): HistoryStore {
    if (!this._instance) this._instance = new HistoryStore();
    return this._instance;
  }

  readonly storageDir: string;
  private readonly manifestURL: string;
  records: CaptureRecord[] = [];

  private constructor() {
    this.storageDir = path.join(app.getPath("userData"), "library");
    this.manifestURL = path.join(this.storageDir, "history.json");
    fs.mkdirSync(this.storageDir, { recursive: true });
    this.loadRecords();
  }

  importCapture(from: string, deleteSource = true, kind: CaptureKind = "screenshot"): CaptureRecord | null {
    const ext = path.extname(from).replace(".", "") || "png";
    const filename = `reflecto_${randomUUID()}.${ext}`;
    const dest = path.join(this.storageDir, filename);
    try {
      fs.copyFileSync(from, dest);
    } catch (err) {
      console.error("[Reflecto] Failed to import capture:", err);
      return null;
    }
    const size = pixelSize(dest, kind);
    const record: CaptureRecord = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      filename,
      pixelWidth: size.width,
      pixelHeight: size.height,
      kind,
      hasAnnotations: false,
    };
    this.insert(record);
    if (deleteSource) {
      try { fs.unlinkSync(from); } catch { /* ignore */ }
    }
    return record;
  }

  setBeautifiedPath(filePath: string, recordID: string): boolean {
    const index = this.records.findIndex((r) => r.id === recordID);
    if (index < 0) return false;
    const superseded = this.records[index].beautifiedPath;
    if (superseded && superseded !== filePath && superseded.startsWith(this.storageDir + path.sep)) {
      try { fs.unlinkSync(superseded); } catch { /* ignore */ }
    }
    this.records[index] = { ...this.records[index], beautifiedPath: filePath };
    this.saveRecords();
    return true;
  }

  urlForRecord(record: CaptureRecord): string {
    if (record.sourcePath) return record.sourcePath;
    return path.join(this.storageDir, record.filename);
  }

  displayURLForRecord(record: CaptureRecord): string {
    if (record.beautifiedPath && fs.existsSync(record.beautifiedPath)) return record.beautifiedPath;
    return this.urlForRecord(record);
  }

  recordMatching(filePath: string): CaptureRecord | null {
    const normalized = path.normalize(filePath);
    return this.records.find((record) => {
      const raw = path.normalize(this.urlForRecord(record));
      const beautified = record.beautifiedPath ? path.normalize(record.beautifiedPath) : null;
      const display = path.normalize(this.displayURLForRecord(record));
      return raw === normalized || beautified === normalized || display === normalized;
    }) ?? null;
  }

  deleteRecord(record: CaptureRecord) {
    this.records = this.records.filter((r) => r.id !== record.id);
    this.saveRecords();
    try {
      const file = this.urlForRecord(record);
      if (file.startsWith(this.storageDir) && fs.existsSync(file)) fs.unlinkSync(file);
    } catch { /* ignore */ }
  }

  recent(kind?: CaptureKind, limit = 12): CaptureRecord[] {
    const list = kind ? this.records.filter((r) => r.kind === kind) : this.records;
    return list.slice(0, limit);
  }

  private insert(record: CaptureRecord) {
    this.records.unshift(record);
    if (this.records.length > MAX_RETENTION) {
      this.records = this.records.slice(0, MAX_RETENTION);
    }
    this.saveRecords();
  }

  private loadRecords() {
    try {
      if (!fs.existsSync(this.manifestURL)) return;
      const raw = JSON.parse(fs.readFileSync(this.manifestURL, "utf8")) as CaptureRecord[];
      this.records = Array.isArray(raw) ? raw : [];
    } catch {
      this.records = [];
    }
  }

  private saveRecords() {
    fs.writeFileSync(this.manifestURL, JSON.stringify(this.records, null, 2), "utf8");
  }
}

function pixelSize(filePath: string, kind: CaptureKind): { width: number; height: number } {
  if (kind === "recording") return { width: 0, height: 0 };
  try {
    const img = nativeImage.createFromPath(filePath);
    const size = img.getSize();
    return { width: size.width, height: size.height };
  } catch {
    return { width: 0, height: 0 };
  }
}

/** Bounded thumbnail decode (HistoryStore.decodeThumbnail). */
export function decodeThumbnail(filePath: string, maxSize = 240): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const img = nativeImage.createFromPath(filePath);
    const size = img.getSize();
    const longest = Math.max(size.width, size.height);
    const scaled = longest > maxSize
      ? img.resize({
          width: Math.round(size.width * (maxSize / longest)),
          height: Math.round(size.height * (maxSize / longest)),
        })
      : img;
    return scaled.toDataURL();
  } catch {
    return null;
  }
}
