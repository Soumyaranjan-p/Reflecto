import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../build");
fs.mkdirSync(dir, { recursive: true });

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const head = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(head));
  return Buffer.concat([len, head, crc]);
}

function makePng(size, paint) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[(size * 4 + 1) * y] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = paint(x, y, size);
      const o = (size * 4 + 1) * y + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function clover(x, y, size) {
  const n = (v) => (v + 0.5) / size;
  const cx = n(x) - 0.5;
  const cy = n(y) - 0.5;
  const leaf = (ox, oy) => {
    const dx = cx - ox;
    const dy = cy - oy;
    return dx * dx + dy * dy < 0.045;
  };
  const stem = Math.abs(cx) < 0.045 && cy > 0.02 && cy < 0.38;
  const hit = leaf(0, -0.16) || leaf(-0.16, 0.02) || leaf(0.16, 0.02) || leaf(0, 0.18) || stem;
  if (!hit) return [0, 0, 0, 0];
  return [46, 184, 92, 255];
}

const png32 = makePng(32, clover);
const png256 = makePng(256, clover);
fs.writeFileSync(path.join(dir, "tray.png"), png32);
fs.writeFileSync(path.join(dir, "icon.png"), png256);

function pngToIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0;
  entry[1] = 0;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

fs.writeFileSync(path.join(dir, "icon.ico"), pngToIco(png256));
console.log("wrote build/tray.png, build/icon.png, build/icon.ico");
