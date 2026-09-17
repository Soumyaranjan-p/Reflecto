import React from "react";

/**
 * Annotation toolbar icons redrawn as inline SVG (24px grid, ~1.7px stroke,
 * round caps/joins) in the style of BetterShot's SF Symbols usage
 * (AnnotationTool.systemImage, 12pt medium). Filled glyphs stay filled, like
 * their SF counterparts. Nothing copied — new paths, same weight.
 */
function S({ children, size = 16 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function F({ children, size = 16 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {children}
    </svg>
  );
}

// hand.point.up.left
export const SelectIcon = () => (
  <F><path d="M6.5 3.5 19 11l-7.2 1.6-2.3 7z" /></F>
);
// rectangle
export const RectangleIcon = () => (
  <S><rect x="4" y="7" width="16" height="10" rx="1.5" /></S>
);
// square.fill
export const FilledRectangleIcon = () => (
  <F><rect x="4" y="7" width="16" height="10" rx="1.5" /></F>
);
// circle
export const EllipseIcon = () => (
  <S><circle cx="12" cy="12" r="8" /></S>
);
// line.diagonal
export const LineIcon = () => (
  <S><path d="M6 18 18 6" /></S>
);
// arrow.up.right
export const ArrowIcon = () => (
  <S><path d="M7 17 17 7M9.5 7H17v7.5" /></S>
);
// scribble
export const FreehandIcon = () => (
  <S><path d="M4 16c2-6 4-9 6-9s1.5 5 3.5 5S17 8 18 6c.7 3-.5 8-2.5 10.5" /></S>
);
// 1.circle.fill — outline + currentColor glyph so the "1" stays readable
// in both resting and selected (filled-accent) states.
export const NumberedCircleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="700"
      fontFamily="'Segoe UI Variable','Segoe UI',sans-serif" fill="currentColor">1</text>
  </svg>
);
// textformat
export const TextIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <text x="12" y="17.5" textAnchor="middle" fontSize="15" fontWeight="700"
      fontFamily="'Segoe UI Variable','Segoe UI',sans-serif" fill="currentColor">T</text>
  </svg>
);
// square.dashed.inset.filled
export const HighlightIcon = () => (
  <S>
    <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3.5 3" />
    <rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none" />
  </S>
);
// app.background.dotted
export const PixelateIcon = () => (
  <F>
    <circle cx="6.5" cy="6.5" r="1.6" /><circle cx="12" cy="6.5" r="1.6" /><circle cx="17.5" cy="6.5" r="1.6" />
    <circle cx="6.5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="17.5" cy="12" r="1.6" />
    <circle cx="6.5" cy="17.5" r="1.6" /><circle cx="12" cy="17.5" r="1.6" /><circle cx="17.5" cy="17.5" r="1.6" />
  </F>
);
// drop.fill
export const BlurIcon = () => (
  <F><path d="M12 3.5c3.5 4.5 6 8 6 11.5a6 6 0 1 1-12 0C6 11.5 8.5 8 12 3.5z" /></F>
);
// crop
export const CropIcon = () => (
  <S><path d="M6 2v16h16M2 6h16v16" /></S>
);
// eye.slash
export const SmartRedactIcon = () => (
  <S>
    <path d="M4 4l16 16" />
    <path d="M10.6 5.2A9 9 0 0 1 12 5c5 0 8.5 4.5 9.5 6-.4.8-1.3 2-2.7 3.2M6.6 6.6C4.8 7.9 3.2 10 2.5 11c1 1.5 4.5 6 9.5 6 1.5 0 2.8-.4 4-1" />
  </S>
);

export const TOOL_ICONS: Record<string, () => React.JSX.Element> = {
  select: SelectIcon,
  rectangle: RectangleIcon,
  filledRectangle: FilledRectangleIcon,
  ellipse: EllipseIcon,
  line: LineIcon,
  arrow: ArrowIcon,
  freehand: FreehandIcon,
  numberedCircle: NumberedCircleIcon,
  text: TextIcon,
  highlight: HighlightIcon,
  pixelate: PixelateIcon,
  blur: BlurIcon,
};
