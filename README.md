# Reflecto

**One app for the whole screen — on Windows.** Screenshots, annotation, screen recording, and capture history. A Windows-first counterpart inspired by [BetterShot](https://github.com/KartikLabhshetwar/better-shot), with its own architecture, UI naming, and implementation (Electron + React).

No subscription, no account, and no telemetry. Nothing leaves your PC unless you share it, and shares go to storage you own (Cloudflare R2).

## Features

- **Screenshots:** region, fullscreen, window (picker), previous-region repeat, and timed region. Region selector with ghost reuse, guide lines, and eight resize handles. Multi-monitor and DPI aware, with a configurable self-timer.
- **Private staging:** Copy is clipboard-only. Screenshots stay in private working storage until you choose Save; only explicit Save writes to your export folder.
- **Capture deck:** up to five floating cards with Copy, Save, Pin, Edit, Dismiss, cloud Share, and drag-out. Configurable card size, corner position, edge margin, and auto-dismiss.
- **Default Look:** No Background, solid color (12 presets + custom picker), or ten soft gradients (Blush, Peach, Mint, Powder Blue, Butter, Lilac, Sage, Coral, Aqua, Mauve), with padding, corners, shadow, and a screenshot border ring.
- **3D camera:** true perspective projection of the screenshot over its background — tilt, rotate, roll, FOV, zoom, and pan.
- **Progressive blur:** radial or directional background blur with strength, falloff, focus size/position/direction, applied to the screenshot or the whole scene.
- **Watermark:** diagonal tiled text with text, opacity, size, angle, density, and color.
- **Image editor:** icon toolbar in BetterShot's tool order (select → blur) with filled-accent active state; select, rectangle, filled rectangle, ellipse, line, arrow, freehand, numbered circle, text (size, bold, italic, underline, left/center/right), spotlight, pixelate, blur, and crop. Rotate handle + rotation slider, undo/redo, zoom, Copy, and Save.
- **Smart Redact:** auto-detects emails, URLs, IPs, phone numbers, credit-card numbers, JWTs, API keys, and `password:=value` secrets via Tesseract OCR and covers them with blur boxes in one undo step.
- **Non-destructive projects:** Save writes the flat image plus a `<image>.reflecto.json` sidecar and a `<stem>.base.png` pristine source, so reopening the editor restores every shape and effect setting exactly.
- **Screen recording:** recording bar with Start / Stop / Pause / Restart / Discard (pause writes real segments, stitched on stop). Display, area, and window sources at 30/60 fps, with microphone, system audio, a separate camera file, and cursor styles (recorded, hidden, or composited dot/hand/dark/light).
- **Video studio:** multi-clip timeline (split/trim, per-clip speed 0.25–8×), timed blur/pixelate masks with per-mask strength, crop, and an export matrix — H.264/HEVC, Original/1080p/720p/480p, MP4/MOV, High/Medium/Low quality. Audio-only M4A/WAV export and replacement-audio export included.
- **Pin windows:** keep captures floating above other apps; scroll to zoom; unpin all from the tray.
- **Media Gallery:** browse screenshots and recordings with search and filters; open or delete from the library (deletes go via the Recycle Bin).
- **Cloud sharing:** upload to your own Cloudflare R2 bucket (AWS SigV4). Link is copied on success.
- **Tray-first:** lives in the system tray; left-click opens the capture panel (Region, Screen, Window, Record, OCR, Color, Gallery, Settings) — 296px two-column grid with live shortcut hints, matching BetterShot's menu-bar popover metrics.
- **Onboarding:** first-run walkthrough (welcome, permissions, shortcuts, first capture).
- **Automation:** `reflecto://` URL scheme (`capture/region`, `capture/fullscreen`, `capture/window`, `ocr`, `color-picker`, `record`, `settings`).

## Requirements

- Windows 10 or 11
- Node.js 18+ (for building from source)

## Run from source

```bash
cd reflecto
npm install
npm run dev
```

The app starts in the tray. Left-click the Reflecto icon for the capture panel
(Region, Screen, Window, Record, OCR, Pick Color, Gallery, Settings).

### Production build

```bash
npm run build
npm start
```

### Installer

```bash
npm run dist
```

Outputs NSIS / MSI installers under `release/`.

## Default shortcuts

macOS ⌘ mappings use **Ctrl** on Windows. Win key is never used in defaults.
Everything below is remappable from Settings → Shortcuts.

| Action | Shortcut |
|---|---|
| Region screenshot | `Ctrl+Shift+4` |
| Fullscreen screenshot | `Ctrl+Shift+3` |
| OCR text scan | `Ctrl+Shift+O` |
| Color picker | `Ctrl+Shift+C` |
| Capture & recording bar | `Ctrl+Shift+2` |
| Recording options | `Ctrl+Shift+5` |

More actions (previous region, timed region, deck controls, pin last, and so on)
are registered in the shortcut catalog and can be bound from Settings as
customization lands.

## Settings

| Tab | What it controls |
|---|---|
| **General** | Launch at login, copy after capture, open editor after capture/recording, keep in deck until saved, capture on mouse release, self-timer, save folder |
| **Default Look** | Background (none / solid / gradient), padding, corners, shadow, screenshot border |
| **Capture Deck** | Card size, position, edge margin, auto-dismiss, always show actions |
| **Recording** | Show cursor, frame rate |
| **Shortcuts** | Click-to-rerecord bindings with per-row Reset, live hints in the tray panel |
| **Sharing** | Cloudflare R2 account ID, bucket, public base URL, access keys, test connection |
| **About** | Version and app info |

## Project layout

```
reflecto/
├── electron/          # Main process (tray, capture, deck, recording, R2, settings)
│   ├── capture/       # Capture orchestrator, region geometry, pixel sampler
│   ├── e2e/           # App/record/editor verification harnesses + fixtures
│   ├── editor/        # Annotate/video presenters, sidecar documents
│   ├── ocr/           # Tesseract word-level OCR + Smart Redact pipeline
│   └── recording/     # Capture engine, gdigrab, ffmpeg, cursor overlays, export
├── preload/           # contextBridge API
├── src/
│   ├── tray/          # Tray popover UI
│   ├── overlay/       # Region selection, window picker
│   ├── preview/       # Capture deck
│   ├── editor/        # Annotation editor
│   ├── gallery/       # Media gallery
│   ├── settings/      # Preferences window
│   ├── recording/     # Recording bar
│   ├── video/         # Video studio
│   ├── shared/        # Beautifier types + canvas renderer, sidecar, clip math
│   └── theme/         # Design tokens (BetterShot chrome metrics)
├── scripts/           # esbuild bundler for main/preload
└── package.json
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite + Electron with hot reload |
| `npm run build` | Production renderer + main bundles |
| `npm run typecheck` | TypeScript check |
| `npm start` | Run packaged `dist` + `dist-electron` |
| `npm run dist` | Windows installer via electron-builder |

## Architecture notes

Reflecto mirrors BetterShot's workflows and UI metrics where practical, with
Windows equivalents:

| BetterShot (macOS) | Reflecto (Windows) |
|---|---|
| SwiftUI / AppKit | Electron + React |
| SF Symbols icons | redrawn inline SVG set (24px grid, 1.7px stroke, round caps) |
| SF Pro | Segoe UI Variable |
| Menu bar popover | System tray + frameless panel |
| ScreenCaptureKit / `screencapture` | `desktopCapturer` + region overlay |
| Vision OCR | tesseract.js |
| Sparkle | electron-updater |
| SMAppService login item | auto-launch / login item settings |
| ffmpeg via system tools | bundled `ffmpeg-static` (gdigrab) |

Captures stage under the app userData `deck/` folder with a `*.raw.png`
companion; Save promotes into your Pictures/Reflecto (or configured) folder.
History lives in `library/history.json`.

## Still catching up to BetterShot

These are planned or partial relative to the macOS app:

- Occlusion-safe window capture (needs a Windows Graphics Capture helper; current window capture reads desktop pixels)
- Multi-style text beyond bold/italic/underline/align (no font-family picker yet; no caret-anchored overlay editing)
- Zoom cues, transcription/subtitles, and teleprompter in the studio
- In-app trash/restore (deletes currently go through the Recycle Bin)
- Cloud share list/delete (R2 upload only for now)

## License

Use and redistribute under the same terms you apply to this workspace. Reflecto
is an independent Windows implementation inspired by BetterShot's product
behavior — not a fork of its native source.
