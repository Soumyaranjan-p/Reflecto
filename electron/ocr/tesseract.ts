import Tesseract from "tesseract.js";

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
