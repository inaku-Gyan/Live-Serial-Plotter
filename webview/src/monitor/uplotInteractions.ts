import type uPlot from "uplot";

interface TimeSeriesInteractionPluginOptions {
  config?: TimeSeriesInteractionConfig;
  onScaleChanged(scaleKey: string): void;
  resetView(): void;
}

interface TimeSeriesInteractionConfig {
  cursor: uPlot.Cursor;
  wheel: WheelInteractionConfig;
  pointer: PointerInteractionConfig;
  doubleClick: DoubleClickInteractionConfig;
}

interface WheelInteractionConfig {
  minXRange: number;
  panX: WheelPanBinding[];
  panY: WheelPanBinding[];
  zoomX: WheelZoomBinding;
}

interface WheelBinding {
  modifiers: WheelModifierBinding;
}

interface WheelModifierBinding {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

interface WheelPanBinding extends WheelBinding {
  deltaAxis: "x" | "y";
}

interface WheelZoomBinding extends WheelBinding {
  deltaAxis: "x" | "y";
  factor: number;
  referenceDelta: number;
}

interface PointerInteractionConfig {
  pan: PointerPanBinding[];
  pinchZoomX: boolean;
}

interface PointerPanBinding {
  button?: number;
  pointerTypes: readonly string[];
  modifiers?: PointerModifierBinding;
}

interface PointerModifierBinding {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

interface DoubleClickInteractionConfig {
  resetView: boolean;
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
  minRange: number;
  startDistance: number;
  startRange: number;
}

export const defaultTimeSeriesInteractionConfig: TimeSeriesInteractionConfig = {
  cursor: {
    drag: {
      dist: 8,
      setScale: true,
      x: true,
      y: false,
    },
    focus: {
      prox: 10,
    },
    hover: {
      prox: 10,
    },
    points: {
      one: true,
    },
  },
  wheel: {
    minXRange: 1e-9,
    panX: [
      {
        deltaAxis: "y",
        modifiers: {
          ctrlKey: false,
          shiftKey: true,
        },
      },
      {
        deltaAxis: "x",
        modifiers: {
          ctrlKey: false,
          shiftKey: false,
        },
      },
    ],
    panY: [
      {
        deltaAxis: "y",
        modifiers: {
          ctrlKey: false,
          shiftKey: false,
        },
      },
    ],
    zoomX: {
      deltaAxis: "y",
      factor: 0.5,
      modifiers: {
        ctrlKey: true,
      },
      referenceDelta: 100,
    },
  },
  pointer: {
    pan: [
      {
        pointerTypes: ["touch", "pen"],
      },
      {
        button: 1,
        pointerTypes: ["mouse"],
      },
      {
        button: 0,
        modifiers: {
          shiftKey: true,
        },
        pointerTypes: ["mouse"],
      },
    ],
    pinchZoomX: true,
  },
  doubleClick: {
    resetView: true,
  },
};

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
  const config = options.config ?? defaultTimeSeriesInteractionConfig;
  const overlay = plot.over;
  const previousTouchAction = overlay.style.touchAction;
  const activePointers = new Map<number, PointerPosition>();
  let panState: PanState | undefined;
  let pinchState: PinchState | undefined;

  overlay.style.touchAction = "none";

  function handleWheel(event: WheelEvent): void {
    const rect = plot.over.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    if (matchesWheelBinding(event, config.wheel.zoomX)) {
      const zoomDelta = getWheelDelta(event, config.wheel.zoomX.deltaAxis, rect);

      if (zoomDelta !== 0 && applyWheelZoomX(plot, event, rect, zoomDelta, config.wheel)) {
        event.preventDefault();
      }

      return;
    }

    const panXDelta = getWheelPanDelta(event, config.wheel.panX, rect);
    const panYDelta = getWheelPanDelta(event, config.wheel.panY, rect);
    const didPanX = panXDelta !== 0 && panXScales(plot, panXDelta, rect.width);
    const didPanY = panYDelta !== 0 && panYScales(plot, panYDelta, rect.height);

    if (didPanX || didPanY) {
      event.preventDefault();
    }
  }

  function applyWheelZoomX(
    targetPlot: uPlot,
    event: WheelEvent,
    rect: DOMRect,
    zoomDelta: number,
    wheelConfig: WheelInteractionConfig,
  ): boolean {
    const xScale = getFiniteScale(targetPlot, "x");

    if (xScale === undefined) {
      return false;
    }

    const left = clampNumber(event.clientX - rect.left, 0, rect.width);
    const anchorRatio = left / rect.width;
    const anchorValue = targetPlot.posToVal(left, "x");
    const currentRange = xScale.max - xScale.min;
    const zoomRatio = Math.pow(
      wheelConfig.zoomX.factor,
      Math.abs(zoomDelta) / wheelConfig.zoomX.referenceDelta,
    );
    const nextRange = zoomDelta < 0 ? currentRange * zoomRatio : currentRange / zoomRatio;

    return setXRangeAroundAnchor(
      targetPlot,
      anchorValue,
      anchorRatio,
      nextRange,
      wheelConfig.minXRange,
    );
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!matchesPointerPanBinding(event, config.pointer.pan)) {
      return;
    }

    const xScale = getFiniteScale(plot, "x");
    const rect = plot.over.getBoundingClientRect();

    if (xScale === undefined || rect.width <= 0) {
      return;
    }

    event.preventDefault();
    activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    capturePointer(overlay, event.pointerId);

    if (activePointers.size >= 2 && event.pointerType !== "mouse" && config.pointer.pinchZoomX) {
      panState = undefined;
      pinchState = createPinchState(plot, activePointers, rect, config.wheel.minXRange);
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

    setFiniteScale(plot, "x", panState.startMin - deltaUnits, panState.startMax - deltaUnits);
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
    if (!config.doubleClick.resetView) {
      return;
    }

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
  minRange: number,
): PinchState | undefined {
  const first = [...activePointers.entries()].slice(0, 2);
  const firstPointer = first[0];
  const secondPointer = first[1];
  const xScale = getFiniteScale(plot, "x");

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
    minRange,
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
    pinchState.minRange,
  );
}

function setXRangeAroundAnchor(
  plot: uPlot,
  anchorValue: number,
  anchorRatio: number,
  nextRange: number,
  minRange: number,
): boolean {
  if (!Number.isFinite(anchorValue) || !Number.isFinite(nextRange)) {
    return false;
  }

  const range = Math.max(minRange, nextRange);
  const min = anchorValue - anchorRatio * range;
  const max = min + range;
  return setFiniteScale(plot, "x", min, max);
}

function getWheelPanDelta(
  event: WheelEvent,
  bindings: readonly WheelPanBinding[],
  rect: DOMRect,
): number {
  let delta = 0;

  for (const binding of bindings) {
    if (matchesWheelBinding(event, binding)) {
      delta += getWheelDelta(event, binding.deltaAxis, rect);
    }
  }

  return delta;
}

function getWheelDelta(event: WheelEvent, axis: "x" | "y", rect: DOMRect): number {
  const delta = axis === "x" ? event.deltaX : event.deltaY;

  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return delta * 16;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return delta * (axis === "x" ? rect.width : rect.height);
  }

  return delta;
}

function panXScales(plot: uPlot, delta: number, width: number): boolean {
  const xScale = getFiniteScale(plot, "x");

  if (xScale === undefined || width <= 0) {
    return false;
  }

  const deltaUnits = ((xScale.max - xScale.min) / width) * delta;
  return setFiniteScale(plot, "x", xScale.min + deltaUnits, xScale.max + deltaUnits);
}

function panYScales(plot: uPlot, delta: number, height: number): boolean {
  if (height <= 0) {
    return false;
  }

  let didPan = false;

  for (const scaleKey of getYScaleKeys(plot)) {
    const yScale = getFiniteScale(plot, scaleKey);

    if (yScale === undefined) {
      continue;
    }

    const deltaUnits = ((yScale.max - yScale.min) / height) * delta;
    didPan =
      setFiniteScale(plot, scaleKey, yScale.min + deltaUnits, yScale.max + deltaUnits) || didPan;
  }

  return didPan;
}

function getYScaleKeys(plot: uPlot): string[] {
  return Object.keys(plot.scales).filter((scaleKey) => scaleKey !== "x");
}

function matchesWheelBinding(event: WheelEvent, binding: WheelBinding): boolean {
  return matchesModifierBinding(event, binding.modifiers);
}

function matchesPointerPanBinding(
  event: PointerEvent,
  bindings: readonly PointerPanBinding[],
): boolean {
  return bindings.some((binding) => {
    if (!binding.pointerTypes.includes(event.pointerType)) {
      return false;
    }

    if (binding.button !== undefined && event.button !== binding.button) {
      return false;
    }

    return matchesModifierBinding(event, binding.modifiers ?? {});
  });
}

function matchesModifierBinding(
  event: Pick<WheelEvent | PointerEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
  binding: WheelModifierBinding | PointerModifierBinding,
): boolean {
  return (
    matchesOptionalModifier(event.altKey, binding.altKey) &&
    matchesOptionalModifier(event.ctrlKey, binding.ctrlKey) &&
    matchesOptionalModifier(event.metaKey, binding.metaKey) &&
    matchesOptionalModifier(event.shiftKey, binding.shiftKey)
  );
}

function matchesOptionalModifier(actual: boolean, expected: boolean | undefined): boolean {
  return expected === undefined || actual === expected;
}

function getFiniteScale(plot: uPlot, scaleKey: string): { min: number; max: number } | undefined {
  const scale = plot.scales[scaleKey];
  const min = scale?.min;
  const max = scale?.max;

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

function setFiniteScale(plot: uPlot, scaleKey: string, min: number, max: number): boolean {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return false;
  }

  plot.setScale(scaleKey, { min, max });
  return true;
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
