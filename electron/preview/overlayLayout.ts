/**
 * Port of Sources/Models/OverlayLayout.swift.
 */

export type OverlayToolSlot =
  | "topLeft" | "topRight" | "centerLeft" | "centerRight" | "bottomLeft" | "bottomRight";

export type OverlayTool = "pin" | "dismiss" | "copy" | "save" | "edit" | "share";

export const OVERLAY_SLOTS: OverlayToolSlot[] = [
  "topLeft", "topRight", "centerLeft", "centerRight", "bottomLeft", "bottomRight",
];

export const TOOL_META: Record<OverlayTool, { title: string }> = {
  pin: { title: "Pin" },
  dismiss: { title: "Dismiss" },
  copy: { title: "Copy" },
  save: { title: "Save" },
  edit: { title: "Edit" },
  share: { title: "Cloud Share" },
};

export type OverlayToolLayout = Partial<Record<OverlayToolSlot, OverlayTool>>;

export const LAYOUT_STANDARD: OverlayToolLayout = {
  topLeft: "pin",
  topRight: "dismiss",
  centerLeft: "copy",
  centerRight: "save",
  bottomLeft: "edit",
  bottomRight: "share",
};

export const LAYOUT_SHARING: OverlayToolLayout = {
  topLeft: "pin",
  topRight: "dismiss",
  centerLeft: "copy",
  centerRight: "share",
  bottomLeft: "edit",
  bottomRight: "save",
};

export const LAYOUT_MINIMAL: OverlayToolLayout = {
  topRight: "dismiss",
  centerLeft: "copy",
  centerRight: "save",
};

export function parseToolLayout(raw: string | null | undefined): OverlayToolLayout {
  if (!raw) return { ...LAYOUT_STANDARD };
  try {
    const stored = JSON.parse(raw) as Record<string, string>;
    const assignments: OverlayToolLayout = {};
    const used = new Set<OverlayTool>();
    for (const slot of OVERLAY_SLOTS) {
      const tool = stored[slot] as OverlayTool | undefined;
      if (tool && TOOL_META[tool] && !used.has(tool)) {
        assignments[slot] = tool;
        used.add(tool);
      }
    }
    if (![...Object.values(assignments)].includes("dismiss")) {
      assignments.topRight = "dismiss";
    }
    return assignments;
  } catch {
    return { ...LAYOUT_STANDARD };
  }
}

export type OverlayCardSize = "small" | "medium" | "large";

const CARD_METRICS: Record<OverlayCardSize, { thumbW: number; thumbH: number; controlScale: number }> = {
  small: { thumbW: 130, thumbH: 98, controlScale: 1 },
  medium: { thumbW: 190, thumbH: 140, controlScale: 1.25 },
  large: { thumbW: 250, thumbH: 180, controlScale: 1.5 },
};

const SHADOW_HEADROOM = 24;
export const CARD_SPACING = 10;
export const CLEAR_ALL_HEIGHT = 26;
export const MAX_DECK_ITEMS = 5;

export function cardMetrics(size: OverlayCardSize) {
  return CARD_METRICS[size] ?? CARD_METRICS.small;
}

export function basePanelSize(size: OverlayCardSize, margin: number) {
  const m = cardMetrics(size);
  return {
    width: m.thumbW + margin + SHADOW_HEADROOM,
    height: m.thumbH + margin + SHADOW_HEADROOM,
  };
}

export function panelSizeForCount(size: OverlayCardSize, margin: number, count: number) {
  const base = basePanelSize(size, margin);
  const m = cardMetrics(size);
  const extra = Math.max(count - 1, 0);
  const height =
    base.height +
    extra * (m.thumbH + CARD_SPACING) +
    (count > 1 ? CLEAR_ALL_HEIGHT : 0);
  return { width: base.width, height };
}
