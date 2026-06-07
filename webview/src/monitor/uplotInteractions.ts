import type uPlot from "uplot";

interface TimeSeriesInteractionPluginOptions {
  onScaleChanged(scaleKey: string): void;
  resetView(): void;
}

interface PointerPosition {
  clientX: number;
  clientY: number;
}

interface PanState {
  pointerId: number;
  startClientX: number;
  startMin: number;
  startMax: number;
  unitsPerPixel: number;
}

interface PinchState {
  firstPointerId: number;
  secondPointerId: number;
  anchorValue: number;
  startDistance: number;
  startRange: number;
}

const wheelZoomFactor = 0.85;
const minXRange = 1e-9;

export function createTimeSeriesInteractionPlugins(
  options: TimeSeriesInteractionPluginOptions,
): uPlot.Plugin[] {
  return [createScaleTrackingPlugin(options), createGesturePlugin(options)];
}

function createScaleTrackingPlugin(options: TimeSeriesInteractionPluginOptions): uPlot.Plugin {
  return {
    hooks: {
      setScale: (_plot, scaleKey) => {
        options.onScaleChanged(scaleKey);
      },
    },
  };
}

function createGesturePlugin(options: TimeSeriesInteractionPluginOptions): uPlot.Plugin {
  let cleanup: (() => void) | undefined;

  return {
    hooks: {
      ready: (plot) => {
        cleanup?.();
        cleanup = installGestureHandlers(plot, options);
      },
      destroy: () => {
        cleanup?.();
        cleanup = undefined;
      },
    },
  };
}

function installGestureHandlers(
  plot: uPlot,
  options: TimeSeriesInteractionPluginOptions,
): () => void {
  const overlay = plot.over;
  const previousTouchAction = overlay.style.touchAction;
  const activePointers = new Map<number, PointerPosition>();
  let panState: PanState | undefined;
  let pinchState: PinchState | undefined;

  overlay.style.touchAction = "none";

  function handleWheel(event: WheelEvent): void {
    const xScale = getFiniteXScale(plot);

    if (xScale === undefined) {
      return;
    }

    const rect = plot.over.getBoundingClientRect();

    if (rect.width <= 0) {
      return;
    }

    event.preventDefault();

    const left = clampNumber(event.clientX - rect.left, 0, rect.width);
    const anchorRatio = left / rect.width;
    const anchorValue = plot.posToVal(left, "x");
    const currentRange = xScale.max - xScale.min;
    const nextRange =
      event.deltaY < 0 ? currentRange * wheelZoomFactor : currentRange / wheelZoomFactor;

    setXRangeAroundAnchor(plot, anchorValue, anchorRatio, nextRange);
  }

  function handlePointerDown(event: PointerEvent): void {
    const isMouse = event.pointerType === "mouse";
    const shouldPan = !isMouse || event.button === 1 || (event.button === 0 && event.shiftKey);

    if (!shouldPan) {
      return;
    }

    const xScale = getFiniteXScale(plot);
    const rect = plot.over.getBoundingClientRect();

    if (xScale === undefined || rect.width <= 0) {
      return;
    }

    event.preventDefault();
    activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    capturePointer(overlay, event.pointerId);

    if (activePointers.size >= 2 && !isMouse) {
      panState = undefined;
      pinchState = createPinchState(plot, activePointers, rect);
      return;
    }

    panState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startMin: xScale.min,
      startMax: xScale.max,
      unitsPerPixel: (xScale.max - xScale.min) / rect.width,
    };
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!activePointers.has(event.pointerId)) {
      return;
    }

    event.preventDefault();
    activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });

    if (pinchState !== undefined) {
      applyPinch(plot, pinchState, activePointers);
      return;
    }

    if (panState?.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - panState.startClientX;
    const deltaUnits = deltaX * panState.unitsPerPixel;

    setFiniteXScale(plot, panState.startMin - deltaUnits, panState.startMax - deltaUnits);
  }

  function handlePointerUp(event: PointerEvent): void {
    activePointers.delete(event.pointerId);
    releasePointer(overlay, event.pointerId);

    if (panState?.pointerId === event.pointerId) {
      panState = undefined;
    }

    if (
      pinchState?.firstPointerId === event.pointerId ||
      pinchState?.secondPointerId === event.pointerId ||
      activePointers.size < 2
    ) {
      pinchState = undefined;
    }
  }

  function handleDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    options.resetView();
  }

  overlay.addEventListener("wheel", handleWheel, { passive: false });
  overlay.addEventListener("pointerdown", handlePointerDown);
  overlay.addEventListener("pointermove", handlePointerMove);
  overlay.addEventListener("pointerup", handlePointerUp);
  overlay.addEventListener("pointercancel", handlePointerUp);
  overlay.addEventListener("dblclick", handleDoubleClick);

  return () => {
    overlay.style.touchAction = previousTouchAction;
    overlay.removeEventListener("wheel", handleWheel);
    overlay.removeEventListener("pointerdown", handlePointerDown);
    overlay.removeEventListener("pointermove", handlePointerMove);
    overlay.removeEventListener("pointerup", handlePointerUp);
    overlay.removeEventListener("pointercancel", handlePointerUp);
    overlay.removeEventListener("dblclick", handleDoubleClick);
  };
}

function createPinchState(
  plot: uPlot,
  activePointers: ReadonlyMap<number, PointerPosition>,
  rect: DOMRect,
): PinchState | undefined {
  const first = [...activePointers.entries()].slice(0, 2);
  const firstPointer = first[0];
  const secondPointer = first[1];
  const xScale = getFiniteXScale(plot);

  if (firstPointer === undefined || secondPointer === undefined || xScale === undefined) {
    return undefined;
  }

  const centerClientX = (firstPointer[1].clientX + secondPointer[1].clientX) / 2;
  const centerLeft = clampNumber(centerClientX - rect.left, 0, rect.width);
  const distance = getPointerDistance(firstPointer[1], secondPointer[1]);

  if (distance <= 0) {
    return undefined;
  }

  return {
    firstPointerId: firstPointer[0],
    secondPointerId: secondPointer[0],
    anchorValue: plot.posToVal(centerLeft, "x"),
    startDistance: distance,
    startRange: xScale.max - xScale.min,
  };
}

function applyPinch(
  plot: uPlot,
  pinchState: PinchState,
  activePointers: ReadonlyMap<number, PointerPosition>,
): void {
  const firstPointer = activePointers.get(pinchState.firstPointerId);
  const secondPointer = activePointers.get(pinchState.secondPointerId);
  const rect = plot.over.getBoundingClientRect();

  if (firstPointer === undefined || secondPointer === undefined || rect.width <= 0) {
    return;
  }

  const centerClientX = (firstPointer.clientX + secondPointer.clientX) / 2;
  const centerLeft = clampNumber(centerClientX - rect.left, 0, rect.width);
  const anchorRatio = centerLeft / rect.width;
  const distance = getPointerDistance(firstPointer, secondPointer);

  if (distance <= 0) {
    return;
  }

  setXRangeAroundAnchor(
    plot,
    pinchState.anchorValue,
    anchorRatio,
    pinchState.startRange * (pinchState.startDistance / distance),
  );
}

function setXRangeAroundAnchor(
  plot: uPlot,
  anchorValue: number,
  anchorRatio: number,
  nextRange: number,
): void {
  if (!Number.isFinite(anchorValue) || !Number.isFinite(nextRange)) {
    return;
  }

  const range = Math.max(minXRange, nextRange);
  const min = anchorValue - anchorRatio * range;
  const max = min + range;
  setFiniteXScale(plot, min, max);
}

function getFiniteXScale(plot: uPlot): { min: number; max: number } | undefined {
  const { min, max } = plot.scales.x;

  if (
    typeof min !== "number" ||
    typeof max !== "number" ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    max <= min
  ) {
    return undefined;
  }

  return { min, max };
}

function setFiniteXScale(plot: uPlot, min: number, max: number): void {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return;
  }

  plot.setScale("x", { min, max });
}

function getPointerDistance(left: PointerPosition, right: PointerPosition): number {
  return Math.hypot(left.clientX - right.clientX, left.clientY - right.clientY);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function capturePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // jsdom and some embedded webviews can expose pointer events without pointer capture.
  }
}

function releasePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.releasePointerCapture(pointerId);
  } catch {
    // Ignore missing pointer capture support.
  }
}
