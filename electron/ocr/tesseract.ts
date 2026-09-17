import Tesseract from "tesseract.js";
import { findSensitiveBoxes, type OcrWord, type SensitiveBox } from "../../src/shared/smartRedact";

/**
 * Port of Sources/BetterShot/ImageTextRecognizer.swift + SmartRedactionRecognizer.swift.
 * PLATFORM GAP: macOS used Apple Vision (RecognizeTextRequest) which has much
 * better accuracy and line/box granularity. tesseract.js is the closest
 * cross-platform equivalent; expect slightly different text results.
 */
export async function runOCR(pngBuffer: Buffer, singleLine: boolean): Promise<string> {
  const worker = await Tesseract.createWorker("eng");
  try {
    const { data } = await worker.recognize(pngBuffer);
    if (singleLine) return data.text.replace(/\s+/g, " ").trim();
    return data.text.trim();
  } finally {
    await worker.terminate();
  }
}

export interface WordBox {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

/** Word-level OCR (bounding boxes) for Smart Redact. Needs network on first
 * run to fetch eng.traineddata unless tesseract.js has it cached. */
export async function recognizeWords(pngBuffer: Buffer): Promise<WordBox[]> {
  const worker = await Tesseract.createWorker("eng");
  try {
    const { data } = await worker.recognize(pngBuffer);
    const words = (data as { words?: Array<{ text?: string; bbox?: WordBox["bbox"]; confidence?: number }> }).words ?? [];
    return words
      .filter((w) => w.text && w.text.trim() && w.bbox)
      .map((w) => ({
        text: w.text as string,
        bbox: w.bbox as WordBox["bbox"],
        confidence: typeof w.confidence === "number" ? w.confidence : -1,
      }));
  } finally {
    await worker.terminate();
  }
}

/** Full Smart Redact pipeline: OCR words -> regex-matched pixel boxes. */
export async function smartRedactBoxes(
  pngBuffer: Buffer,
  imgW: number,
  imgH: number,
): Promise<{ boxes: SensitiveBox[]; wordCount: number }> {
  const words: OcrWord[] = await recognizeWords(pngBuffer);
  return { boxes: findSensitiveBoxes(words, imgW, imgH), wordCount: words.length };
}
