import { drawAnnotations } from "../../../src/editor/draw";
import type { Annotation } from "../../../src/editor/types";

function mkCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number): [number, number, number] {
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2]];
}

const isRed = ([r, g, b]: [number, number, number]) => r > 150 && g < 120 && b < 120;
const isWhite = ([r, g, b]: [number, number, number]) => r > 200 && g > 200 && b > 200;

const src = mkCanvas(200, 200);
const sctx = src.getContext("2d")!;
sctx.fillStyle = "#ffffff";
sctx.fillRect(0, 0, 200, 200);

const bar: Annotation = {
  id: "t",
  tool: "filledRectangle",
  x1: 90,
  y1: 60,
  x2: 110,
  y2: 140,
  color: "#f73833",
  stroke: 6,
};

function render(rot: number | null): CanvasRenderingContext2D {
  const out = mkCanvas(200, 200);
  drawAnnotations(out.getContext("2d")!, src, 200, 200, rot == null ? [bar] : [{ ...bar, rotation: rot }]);
  return out.getContext("2d")!;
}

const plain = render(null);
const rotated = render(Math.PI / 2);

const res = {
  plainCenterRed: isRed(px(plain, 100, 100)),
  plainRightWhite: isWhite(px(plain, 130, 100)),
  plainBottomRed: isRed(px(plain, 100, 130)),
  rotCenterRed: isRed(px(rotated, 100, 100)),
  rotRightRed: isRed(px(rotated, 130, 100)),
  rotBottomWhite: isWhite(px(rotated, 100, 130)),
  pass: false,
};
res.pass =
  res.plainCenterRed &&
  res.plainRightWhite &&
  res.plainBottomRed &&
  res.rotCenterRed &&
  res.rotRightRed &&
  res.rotBottomWhite;
(window as unknown as { __rotResult: typeof res }).__rotResult = res;
