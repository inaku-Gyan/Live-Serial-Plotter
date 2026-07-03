import type { FramePlot2dPacket } from "../../../../../src/shared/protocol";

export function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | undefined {
  try {
    return canvas.getContext("2d") ?? undefined;
  } catch {
    return undefined;
  }
}

export function getCanvasSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    width: Math.max(320, Math.floor(rect.width)),
    height: Math.max(260, Math.floor(rect.height)),
  };
}

export function readCssColor(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = style.getPropertyValue(name).trim();
  return value.length === 0 ? fallback : value;
}

export function inferBounds(
  packet: FramePlot2dPacket | undefined,
): { xMin: number; xMax: number; yMin: number; yMax: number } | undefined {
  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  let count = 0;

  for (const layer of packet?.layers ?? []) {
    for (const point of layer.points) {
      count += 1;
      xMin = Math.min(xMin, point.x);
      xMax = Math.max(xMax, point.x);
      yMin = Math.min(yMin, point.y);
      yMax = Math.max(yMax, point.y);
    }
  }

  if (count === 0) {
    return undefined;
  }

  return {
    xMin: xMin === xMax ? xMin - 1 : xMin,
    xMax: xMin === xMax ? xMax + 1 : xMax,
    yMin: yMin === yMax ? yMin - 1 : yMin,
    yMax: yMin === yMax ? yMax + 1 : yMax,
  };
}

export function drawCenterAxes(
  context: CanvasRenderingContext2D,
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  area: { left: number; top: number; right: number; bottom: number },
  color: string,
): void {
  context.strokeStyle = color;
  context.beginPath();

  if (bounds.xMin < 0 && bounds.xMax > 0) {
    const x = scaleLinear(0, bounds.xMin, bounds.xMax, area.left, area.right);
    context.moveTo(x, area.top);
    context.lineTo(x, area.bottom);
  }

  if (bounds.yMin < 0 && bounds.yMax > 0) {
    const y = scaleLinear(0, bounds.yMin, bounds.yMax, area.bottom, area.top);
    context.moveTo(area.left, y);
    context.lineTo(area.right, y);
  }

  context.stroke();
}

export function scaleLinear(
  value: number,
  fromMin: number,
  fromMax: number,
  toMin: number,
  toMax: number,
): number {
  if (fromMin === fromMax) {
    return (toMin + toMax) / 2;
  }

  return toMin + ((value - fromMin) / (fromMax - fromMin)) * (toMax - toMin);
}
