/**
 * Shared Smart Redact detection — port of BetterShot's
 * SmartRedactionRecognizer.swift regex set (Vision replaced by Tesseract words).
 * Pure: runs in Electron main and renderer without DOM/Node APIs.
 */

export interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence?: number;
}

export type SensitiveKind =
  | "email"
  | "url"
  | "ipv4"
  | "phone"
  | "card"
  | "jwt"
  | "apikey"
  | "token"
  | "secret";

export interface SensitiveBox {
  kind: SensitiveKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const URL_RE = /^(https?:\/\/|www\.)\S+\.\S+/i;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const APIKEY_RE = /^(sk-(live|test)-[A-Za-z0-9]{8,}|sk_[A-Za-z0-9]{8,}|pk_(live|test)_[A-Za-z0-9]{8,}|rk_[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|gho_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|xox[bpas]-[A-Za-z0-9-]{8,})$/;
const TOKEN_RE = /^[A-Za-z0-9\-_~.+=/]{24,}$/;
const SECRET_KEY_RE = /^(password|passwd|secret|api[_-]?key|bearer|token)\s*[:=]/i;
const DIGIT_GROUP_RE = /^\d{3,4}$/;

function stripEdges(s: string): string {
  return s.replace(/^['"“”‘’(\[{<]+|['"“”‘’)\]}>.,;:!?]+$/g, "");
}

function isLikelyIPv4(s: string): boolean {
  if (!IPV4_RE.test(s)) return false;
  return s.split(".").every((o) => {
    if (o.length > 1 && o.startsWith("0")) return false;
    const n = Number(o);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

export function luhnCheck(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

export function classifyWord(raw: string): SensitiveKind | null {
  const s = stripEdges(raw);
  if (!s) return null;
  if (EMAIL_RE.test(s)) return "email";
  if (URL_RE.test(s)) return "url";
  if (isLikelyIPv4(s)) return "ipv4";
  if (JWT_RE.test(s) && s.length >= 20) return "jwt";
  if (APIKEY_RE.test(s)) return "apikey";
  const digits = digitsOnly(s);
  if (digits.length >= 13 && digits.length <= 19 && /^[\d\s-]+$/.test(s) && luhnCheck(digits)) return "card";
  if (digits.length >= 8 && digits.length <= 15 && /^[+()\-\s.\d]+$/.test(s) && /\d/.test(s)) {
    // Phone: digit runs with separators, but not a bare year/short number.
    if (digits.length >= 8) return "phone";
  }
  // Opaque token: long, high-entropy-ish single token (checked after card/phone).
  if (TOKEN_RE.test(s) && /[A-Za-z]/.test(s) && /\d/.test(s)) return "token";
  return null;
}

function union(a: SensitiveBox, b: SensitiveBox): SensitiveBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const r = Math.max(a.x + a.w, b.x + b.w);
  const bt = Math.max(a.y + a.h, b.y + b.h);
  return { kind: a.kind, x, y, w: r - x, h: bt - y };
}

function overlap(a: SensitiveBox, b: SensitiveBox): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const area = Math.min(a.w * a.h, b.w * b.h);
  return area > 0 ? (x * y) / area : 0;
}

/**
 * Map OCR words to redaction boxes (image pixels, clamped).
 * Merges spaced credit-card digit groups and overlapping detections.
 */
export function findSensitiveBoxes(words: OcrWord[], imgW: number, imgH: number): SensitiveBox[] {
  const boxes: SensitiveBox[] = [];
  const clamp = (b: SensitiveBox): SensitiveBox | null => {
    const x = Math.max(0, Math.min(b.x, imgW - 1));
    const y = Math.max(0, Math.min(b.y, imgH - 1));
    const w = Math.max(1, Math.min(b.w, imgW - x));
    const h = Math.max(1, Math.min(b.h, imgH - y));
    return w >= 4 && h >= 4 ? { ...b, x, y, w, h } : null;
  };
  const push = (kind: SensitiveKind, w: OcrWord) => {
    const b = clamp({
      kind,
      x: w.bbox.x0,
      y: w.bbox.y0,
      w: w.bbox.x1 - w.bbox.x0,
      h: w.bbox.y1 - w.bbox.y0,
    });
    if (b) boxes.push(b);
  };

  // Spaced card numbers: runs of adjacent digit-group words on one line.
  const runs: OcrWord[][] = [];
  let run: OcrWord[] = [];
  const flushRun = () => {
    if (run.length >= 2) runs.push(run);
    run = [];
  };
  for (const w of words) {
    const s = stripEdges(w.text);
    if (DIGIT_GROUP_RE.test(s)) {
      const prev = run[run.length - 1];
      const sameLine =
        !prev || Math.abs(prev.bbox.y0 - w.bbox.y0) < (w.bbox.y1 - w.bbox.y0) * 0.8;
      if (sameLine) run.push(w);
      else {
        flushRun();
        run.push(w);
      }
    } else flushRun();
  }
  flushRun();
  const runMembers = new Set<OcrWord>();
  for (const r of runs) {
    const digits = r.map((w) => stripEdges(w.text)).join("");
    if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
      const first = r[0].bbox;
      const last = r[r.length - 1].bbox;
      const b = clamp({
        kind: "card",
        x: first.x0,
        y: Math.min(first.y0, last.y0),
        w: last.x1 - first.x0,
        h: Math.max(first.y1, last.y1) - Math.min(first.y0, last.y0),
      });
      if (b) boxes.push(b);
      r.forEach((w) => runMembers.add(w));
    }
  }

  words.forEach((w, i) => {
    if (runMembers.has(w)) return;
    const s = stripEdges(w.text);
    if (SECRET_KEY_RE.test(s)) {
      // Redact the value, not the key: next word if present, else this word.
      const target = words[i + 1] && !runMembers.has(words[i + 1]) ? words[i + 1] : w;
      push("secret", target);
      return;
    }
    const kind = classifyWord(w.text);
    if (kind) push(kind, w);
  });

  // Merge heavily overlapping boxes (same 85% rule family as BetterShot).
  const merged: SensitiveBox[] = [];
  for (const b of boxes) {
    const hit = merged.find((m) => overlap(m, b) > 0.5);
    if (hit) Object.assign(hit, union(hit, b));
    else merged.push({ ...b });
  }
  return merged;
}
