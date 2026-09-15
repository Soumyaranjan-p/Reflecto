/**
 * Port of Sources/Capture/RegionGeometry.swift — pure coordinate math.
 * macOS: global coords are top-left origin with primary-display-height Y flip
 * for SCK; Windows: everything is top-left origin already, so the conversion
 * collapses to a pass-through (documented deviation — same UX).
 */
export interface Rect {
  x: number; y: number; width: number; height: number;
}
export interface Point {
  x: number; y: number;
}

export const RegionGeometry = {
  /** Windows: screen bounds are already top-left global coordinates. */
  localRect(global: Rect, screenFrame: Rect): Rect {
    return {
      x: global.x - screenFrame.x,
      y: global.y - screenFrame.y,
      width: global.width,
      height: global.height,
    };
  },
  globalRect(local: Rect, screenFrame: Rect): Rect {
    return {
      x: local.x + screenFrame.x,
      y: local.y + screenFrame.y,
      width: local.width,
      height: local.height,
    };
  },
  contains(screenFrame: Rect, rect: Rect): boolean {
    return (
      rect.x >= screenFrame.x && rect.y >= screenFrame.y &&
      rect.x + rect.width <= screenFrame.x + screenFrame.width &&
      rect.y + rect.height <= screenFrame.y + screenFrame.height
    );
  },
};

/** Port of RegionAdjustment (handle drag math). */
export type RegionHandle =
  | "topLeft" | "top" | "topRight" | "right" | "bottomRight" | "bottom" | "bottomLeft" | "left" | "move";

export const RegionAdjustment = {
  handle(at: Point, rect: Rect, hitRadius = 8): RegionHandle | null {
    const corners: Array<[RegionHandle, Point]> = [
      ["topLeft", { x: rect.x, y: rect.y }],
      ["topRight", { x: rect.x + rect.width, y: rect.y }],
      ["bottomRight", { x: rect.x + rect.width, y: rect.y + rect.height }],
      ["bottomLeft", { x: rect.x, y: rect.y + rect.height }],
    ];
    for (const [h, p] of corners) {
      if (Math.hypot(p.x - at.x, p.y - at.y) <= hitRadius) return h;
    }
    const edges: Array<[RegionHandle, Point, Point]> = [
      ["top", { x: rect.x + rect.width / 2, y: rect.y }, { x: 24, y: 6 }],
      ["bottom", { x: rect.x + rect.width / 2, y: rect.y + rect.height }, { x: 24, y: 6 }],
      ["left", { x: rect.x, y: rect.y + rect.height / 2 }, { x: 6, y: 24 }],
      ["right", { x: rect.x + rect.width, y: rect.y + rect.height / 2 }, { x: 6, y: 24 }],
    ];
    for (const [h, p, r] of edges) {
      if (Math.abs(p.x - at.x) <= r.x && Math.abs(p.y - at.y) <= r.y) return h;
    }
    if (at.x >= rect.x && at.x <= rect.x + rect.width && at.y >= rect.y && at.y <= rect.y + rect.height) {
      return "move";
    }
    return null;
  },
  apply(handle: RegionHandle, delta: Point, base: Rect, bounds: Rect): Rect {
    let { x, y, width, height } = base;
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
    switch (handle) {
      case "move":
        x = clamp(x + delta.x, bounds.x, bounds.x + bounds.width - width);
        y = clamp(y + delta.y, bounds.y, bounds.y + bounds.height - height);
        break;
      case "topLeft": x += delta.x; y += delta.y; width -= delta.x; height -= delta.y; break;
      case "top": y += delta.y; height -= delta.y; break;
      case "topRight": width += delta.x; y += delta.y; height -= delta.y; break;
      case "right": width += delta.x; break;
      case "bottomRight": width += delta.x; height += delta.y; break;
      case "bottom": height += delta.y; break;
      case "bottomLeft": x += delta.x; width -= delta.x; height += delta.y; break;
      case "left": x += delta.x; width -= delta.x; break;
    }
    return { x, y, width: Math.max(width, 4), height: Math.max(height, 4) };
  },
};
