import React, { useEffect, useRef, useState } from "react";
import { TrayGridButton } from "./TrayGridButton";

/**
 * Port of MenuBarContentView (MenuBarContentView.swift:70–263) + the
 * MenuBarPanelShape arrow. Panel: 296px wide, padding 12/10, VStack gap 10,
 * 2-column grid gap 6, arrow 22w × 9h with 2.5 tip radius.
 * Entry animation (MenuBarPanelView): scale 0.94→1 anchor-top, opacity 0→1,
 * blur 4→0, spring. Windows shows the window above the taskbar, so the
 * arrow points UP (macOS popover arrow pointed down at the menu bar).
 */
interface RecentRecord {
  filename: string;
  kind: "screenshot" | "recording";
  id?: string;
  path?: string;
}

export interface TrayPanelProps {
  version: string;
  updateAvailable?: string;
  recents: RecentRecord[];
  hasPinnedWindows: boolean;
  onCapture: (kind: "region" | "fullscreen" | "window" | "ocr" | "colorPicker") => void;
  onRecordingOptions: () => void;
  onOpenGallery: () => void;
  onOpenRecent: (record: RecentRecord) => void;
  onUnpinAll: () => void;
  onOpenSettings: () => void;
  onQuit: () => void;
}

export function TrayPanel(props: TrayPanelProps) {
  const [visible, setVisible] = useState(false);
  const [recentMenuOpen, setRecentMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!recentMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setRecentMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [recentMenuOpen]);

  const recentScreenshots = props.recents.filter((r) => r.kind === "screenshot");
  const recentRecordings = props.recents.filter((r) => r.kind === "recording");

  return (
    <div style={{ padding: "9px 8px 8px" }}>
      <div
        className="glass-raised"
        style={{
          transformOrigin: "top center",
          transform: visible ? "scale(1)" : "scale(0.94)",
          opacity: visible ? 1 : 0,
          filter: visible ? "blur(0px)" : "blur(4px)",
          transition: "transform 0.35s var(--show-hide-spring), opacity 0.35s var(--show-hide-spring), filter 0.35s var(--show-hide-spring)",
          borderRadius: "var(--radius-panel)",
          overflow: "hidden",
        }}
      >
        <div style={{ width: "var(--tray-panel-width)", padding: "12px 12px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
          {/* capture grid — 2 columns, gap 6 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--tray-grid-gap)" }}>
            <TrayGridButton title="Region" icon={<RegionIcon />} shortcut="Ctrl+Shift+4" onClick={() => props.onCapture("region")} />
            <TrayGridButton title="Screen" icon={<ScreenIcon />} shortcut="Ctrl+Shift+3" onClick={() => props.onCapture("fullscreen")} />
            <TrayGridButton title="Window" icon={<WindowIcon />} onClick={() => props.onCapture("window")} />
            <TrayGridButton title="Record" icon={<RecordIcon />} onClick={props.onRecordingOptions} />
          </div>

          {/* utility stack */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--tray-grid-gap)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--tray-grid-gap)" }}>
              <TrayGridButton title="OCR" icon={<OCRIcon />} onClick={() => props.onCapture("ocr")} />
              <TrayGridButton title="Pick Color" icon={<EyedropperIcon />} onClick={() => props.onCapture("colorPicker")} />
            </div>

            {/* TrayGridMenu — Recent Captures dropdown */}
            <div ref={menuRef} style={{ position: "relative" }}>
              <TrayGridButton
                title="Recent Captures"
                icon={<ClockIcon />}
                onClick={() => setRecentMenuOpen((v) => !v)}
                fullWidth
              />
              <ChevronDown style={{ position: "absolute", right: 9, top: 10, pointerEvents: "none" }} />
              {recentMenuOpen && (
                <div
                  className="glass-floating"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    borderRadius: "var(--radius-card)",
                    padding: 4,
                    zIndex: 10,
                  }}
                >
                  <MenuSection
                    label="Screenshots"
                    icon={<PhotoIcon />}
                    emptyText="No screenshots yet"
                    items={recentScreenshots.map((r) => ({ label: r.filename, record: r }))}
                    onPick={props.onOpenRecent}
                  />
                  <MenuSection
                    label="Recordings"
                    icon={<VideoIcon />}
                    emptyText="No recordings yet"
                    items={recentRecordings.map((r) => ({ label: r.filename, record: r }))}
                    onPick={props.onOpenRecent}
                  />
                </div>
              )}
            </div>

            <TrayGridButton title="Media Gallery" icon={<GalleryIcon />} onClick={props.onOpenGallery} fullWidth />
          </div>

          {props.hasPinnedWindows && (
            <TrayGridButton title="Unpin All Windows" icon={<PinSlashIcon />} onClick={props.onUnpinAll} fullWidth />
          )}

          <div className="divider-h" />

          {/* footer grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--tray-grid-gap)" }}>
            <TrayGridButton title="Settings" icon={<GearIcon />} onClick={props.onOpenSettings} />
            <TrayGridButton title="Quit" icon={<PowerIcon />} onClick={props.onQuit} />
          </div>

          {/* version label */}
          <div style={{ display: "flex", gap: 5, fontSize: "var(--size-caption)", color: "var(--reflecto-tertiary)" }}>
            <span>Version {props.version}</span>
            {props.updateAvailable && (
              <>
                <span>·</span>
                <span style={{ fontWeight: 500, color: "var(--reflecto-accent)" }}>
                  {props.updateAvailable} available in Settings
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MenuSection({
  label, icon, emptyText, items, onPick,
}: {
  label: string;
  icon: React.ReactNode;
  emptyText: string;
  items: Array<{ label: string; record: RecentRecord }>;
  onPick: (r: RecentRecord) => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", fontSize: "var(--size-control)", fontWeight: 600 }}>
        <span style={{ width: 16, color: "var(--reflecto-secondary)" }}>{icon}</span>
        {label}
      </div>
      {items.length === 0 ? (
        <div style={{ padding: "4px 8px 6px 30px", fontSize: "var(--size-control)", color: "var(--reflecto-tertiary)" }}>
          {emptyText}
        </div>
      ) : (
        items.map((it) => (
          <div
            key={it.label + it.record.kind}
            className="tray-menu-item"
            style={{
              padding: "4px 8px 4px 30px",
              fontSize: "var(--size-control)",
              borderRadius: 4,
              cursor: "default",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            onClick={() => onPick(it.record)}
          >
            {it.label}
          </div>
        ))
      )}
    </div>
  );
}

/* ---- icons: SF Symbols mapped to inline SVGs (stroke 1.5, 12px) ---- */
function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
const RegionIcon = () => <Icon><rect x="3" y="5" width="18" height="14" strokeDasharray="4 3" rx="2" /></Icon>;
const ScreenIcon = () => <Icon><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></Icon>;
const WindowIcon = () => <Icon><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></Icon>;
const RecordIcon = () => <Icon><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" /></Icon>;
const OCRIcon = () => <Icon><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" /><path d="M8 9h8M8 12h8M8 15h5" /></Icon>;
const EyedropperIcon = () => <Icon><path d="m2 22 1-1h3l9-9" /><path d="M3 21v-3l9-9" /><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.9.9a2.1 2.1 0 0 1-3 3l-3.8-3.8a2.1 2.1 0 0 1 3-3Z" /></Icon>;
const ClockIcon = () => <Icon><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>;
const GalleryIcon = () => <Icon><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 15 4-4 5 5 3-3 6 6" /></Icon>;
const PinSlashIcon = () => <Icon><path d="M9 4h6M12 4v6M8 10h8l1 4H7Z" /><path d="M3 3l18 18" /></Icon>;
const GearIcon = () => <Icon><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" /></Icon>;
const PowerIcon = () => <Icon><path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.77.04" /></Icon>;
const PhotoIcon = () => <Icon><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /></Icon>;
const VideoIcon = () => <Icon><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m16 10 6-3v10l-6-3" /></Icon>;
const ChevronDown = ({ style }: { style?: React.CSSProperties }) => (
  <span style={style}><Icon><path d="m6 9 6 6 6-6" /></Icon></span>
);
