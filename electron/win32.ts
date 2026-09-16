import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserWindow } from "electron";

export interface WinRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function parseCapturerHwnd(sourceId: string): number | null {
  const m = sourceId.match(/^window:(\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function nativeHwnd(win: BrowserWindow): number {
  const buf = win.getNativeWindowHandle();
  if (buf.length >= 8) {
    const n = Number(buf.readBigUInt64LE(0) & 0xffffffffn);
    if (n) return n;
  }
  return buf.readUInt32LE(0);
}

const scriptPath = path.join(os.tmpdir(), "reflecto-getwindowrect.ps1");

function ensureScript() {
  const body = [
    "param([int64]$Hwnd)",
    "Add-Type -TypeDefinition @\"",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public struct RECT { public int L; public int T; public int R; public int B; }",
    "public static class RW {",
    "  [DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr h, out RECT r);",
    "}",
    "\"@",
    "$r = New-Object RECT",
    "if (-not [RW]::GetWindowRect([IntPtr]$Hwnd, [ref]$r)) { throw 'GetWindowRect failed' }",
    "Write-Output (\"{0},{1},{2},{3}\" -f $r.L,$r.T,$r.R,$r.B)",
  ].join("\n");
  fs.writeFileSync(scriptPath, body, "utf8");
}

export function getWindowRect(hwnd: number): WinRect | null {
  try {
    ensureScript();
    const out = execFileSync("powershell.exe", ["-NoProfile", "-STA", "-File", scriptPath, String(hwnd)], {
      encoding: "utf8",
      timeout: 12000,
      windowsHide: true,
    }).trim();
    const m = out.match(/(-?\d+),(-?\d+),(-?\d+),(-?\d+)/);
    if (!m) return null;
    const l = Number(m[1]), t = Number(m[2]), r = Number(m[3]), b = Number(m[4]);
    return { x: l, y: t, width: Math.max(2, r - l), height: Math.max(2, b - t) };
  } catch {
    return null;
  }
}

export function evenRect(rect: WinRect): WinRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width - (rect.width % 2),
    height: rect.height - (rect.height % 2),
  };
}
