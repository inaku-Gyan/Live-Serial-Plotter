import type uPlot from "uplot";

interface TimeSeriesInteractionPluginOptions {
  config?: TimeSeriesInteractionConfig;
  onScaleChanged(scaleKey: string): void;
  onUserInteraction?(): void;
  onUserInteractionSettled?(): void;
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
  minYRange: number;
  panX: WheelPanBinding[];
  panY: WheelPanBinding[];
  zoom: WheelZoomBinding;
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
  pinchZoom: boolean;
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

interface ScaleRange {
  min: number;
  max: number;
}

interface PanState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  xRange?: ScaleRange;
  yRanges: Map<string, ScaleRange>;
}

interface PinchState {
  firstPointerId: number;
  secondPointerId: number;
  xAnchorValue?: number;
  xStartRange?: number;
  yAnchorValues: Map<string, number>;
  yStartRanges: Map<string, number>;
  startDistance: number;
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
    minYRange: 1e-9,
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
    zoom: {
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
    pinchZoom: true,
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

    if (matchesWheelBinding(event, config.wheel.zoom)) {
      const zoomDelta = getWheelDelta(event, config.wheel.zoom.deltaAxis, rect);

      if (zoomDelta !== 0 && applyWheelZoom(plot, event, rect, zoomDelta, config.wheel)) {
        notifyUserInteraction();
        event.preventDefault();
      }

      return;
    }

    const panXDelta = getWheelPanDelta(event, config.wheel.panX, rect);
    const panYDelta = getWheelPanDelta(event, config.wheel.panY, rect);
    const didPanX = panXDelta !== 0 && panXScales(plot, panXDelta, rect.width);
    const didPanY = panYDelta !== 0 && panYScales(plot, panYDelta, rect.height);

    if (didPanX || didPanY) {
      notifyUserInteraction();
      event.preventDefault();
    }
  }

  function applyWheelZoom(
    targetPlot: uPlot,
    event: WheelEvent,
    rect: DOMRect,
    zoomDelta: number,
    wheelConfig: WheelInteractionConfig,
  ): boolean {
    const left = clampNumber(event.clientX - rect.left, 0, rect.width);
    const top = clampNumber(event.clientY - rect.top, 0, rect.height);
    const zoomRatio = Math.pow(
      wheelConfig.zoom.factor,
      Math.abs(zoomDelta) / wheelConfig.zoom.referenceDelta,
    );
    const rangeMultiplier = zoomDelta < 0 ? zoomRatio : 1 / zoomRatio;

    return zoomScalesAroundPosition(
      targetPlot,
      left,
      top,
      rangeMultiplier,
      wheelConfig.minXRange,
      wheelConfig.minYRange,
    );
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!matchesPointerPanBinding(event, config.pointer.pan)) {
      return;
    }

    const rect = plot.over.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    event.preventDefault();
    activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    capturePointer(overlay, event.pointerId);

    if (activePointers.size >= 2 && event.pointerType !== "mouse" && config.pointer.pinchZoom) {
      panState = undefined;
      pinchState = createPinchState(plot, activePointers, rect);
      return;
    }

    panState = createPanState(plot, event);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!activePointers.has(event.pointerId)) {
      return;
    }

    event.preventDefault();
    activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });

    if (pinchState !== undefined) {
      if (applyPinch(plot, pinchState, activePointers, config.wheel)) {
        notifyUserInteraction();
      }
      return;
    }

    if (panState?.pointerId !== event.pointerId) {
      return;
    }

    if (applyPan(plot, panState, event)) {
      notifyUserInteraction();
    }
  }

  function handlePointerUp(event: PointerEvent): void {
    const hadInteraction =
      panState?.pointerId === event.pointerId ||
      pinchState?.firstPointerId === event.pointerId ||
      pinchState?.secondPointerId === event.pointerId;

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

    if (hadInteraction) {
      options.onUserInteractionSettled?.();
    }
  }

  function handleDoubleClick(event: MouseEvent): void {
    if (!config.doubleClick.resetView) {
      return;
    }

    event.preventDefault();
    options.resetView();
  }

  function notifyUserInteraction(): void {
    options.onUserInteraction?.();
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

  if (firstPointer === undefined || secondPointer === undefined) {
    return undefined;
  }

  const centerClientX = (firstPointer[1].clientX + secondPointer[1].clientX) / 2;
  const centerClientY = (firstPointer[1].clientY + secondPointer[1].clientY) / 2;
  const centerLeft = clampNumber(centerClientX - rect.left, 0, rect.width);
  const centerTop = clampNumber(centerClientY - rect.top, 0, rect.height);
  const distance = getPointerDistance(firstPointer[1], secondPointer[1]);

  if (distance <= 0) {
    return undefined;
  }

  const xScale = getFiniteScale(plot, "x");
  const yAnchorValues = new Map<string, number>();
  const yStartRanges = new Map<string, number>();

  for (const scaleKey of getYScaleKeys(plot)) {
    const yScale = getFiniteScale(plot, scaleKey);

    if (yScale === undefined) {
      continue;
    }

    yAnchorValues.set(scaleKey, plot.posToVal(centerTop, scaleKey));
    yStartRanges.set(scaleKey, yScale.max - yScale.min);
  }

  if (xScale === undefined && yAnchorValues.size === 0) {
    return undefined;
  }

  return {
    firstPointerId: firstPointer[0],
    secondPointerId: secondPointer[0],
    xAnchorValue: xScale === undefined ? undefined : plot.posToVal(centerLeft, "x"),
    xStartRange: xScale === undefined ? undefined : xScale.max - xScale.min,
    yAnchorValues,
    yStartRanges,
    startDistance: distance,
  };
}

function applyPinch(
  plot: uPlot,
  pinchState: PinchState,
  activePointers: ReadonlyMap<number, PointerPosition>,
  wheelConfig: WheelInteractionConfig,
): boolean {
  const firstPointer = activePointers.get(pinchState.firstPointerId);
  const secondPointer = activePointers.get(pinchState.secondPointerId);
  const rect = plot.over.getBoundingClientRect();

  if (
    firstPointer === undefined ||
    secondPointer === undefined ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return false;
  }

  const centerClientX = (firstPointer.clientX + secondPointer.clientX) / 2;
  const centerClientY = (firstPointer.clientY + secondPointer.clientY) / 2;
  const centerLeft = clampNumber(centerClientX - rect.left, 0, rect.width);
  const centerTop = clampNumber(centerClientY - rect.top, 0, rect.height);
  const distance = getPointerDistance(firstPointer, secondPointer);

  if (distance <= 0) {
    return false;
  }

  const rangeMultiplier = pinchState.startDistance / distance;
  let didZoom = false;

  if (pinchState.xAnchorValue !== undefined && pinchState.xStartRange !== undefined) {
    didZoom =
      setRangeAroundAnchor(
        plot,
        "x",
        pinchState.xAnchorValue,
        centerLeft / rect.width,
        pinchState.xStartRange * rangeMultiplier,
        wheelConfig.minXRange,
      ) || didZoom;
  }

  for (const [scaleKey, anchorValue] of pinchState.yAnchorValues.entries()) {
    const startRange = pinchState.yStartRanges.get(scaleKey);

    if (startRange === undefined) {
      continue;
    }

    didZoom =
      setRangeAroundAnchor(
        plot,
        scaleKey,
        anchorValue,
        getYAnchorRatio(centerTop, rect.height),
        startRange * rangeMultiplier,
        wheelConfig.minYRange,
      ) || didZoom;
  }

  return didZoom;
}

function createPanState(plot: uPlot, event: PointerEvent): PanState | undefined {
  const xRange = getFiniteScale(plot, "x");
  const yRanges = new Map<string, ScaleRange>();

  for (const scaleKey of getYScaleKeys(plot)) {
    const yRange = getFiniteScale(plot, scaleKey);

    if (yRange !== undefined) {
      yRanges.set(scaleKey, yRange);
    }
  }

  if (xRange === undefined && yRanges.size === 0) {
    return undefined;
  }

  return {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    xRange,
    yRanges,
  };
}

function applyPan(plot: uPlot, panState: PanState, event: PointerEvent): boolean {
  const rect = plot.over.getBoundingClientRect();

  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  let didPan = false;

  if (panState.xRange !== undefined) {
    const deltaX = event.clientX - panState.startClientX;
    const xUnitsPerPixel = (panState.xRange.max - panState.xRange.min) / rect.width;
    const xDeltaUnits = deltaX * xUnitsPerPixel;
    didPan =
      setFiniteScale(
        plot,
        "x",
        panState.xRange.min - xDeltaUnits,
        panState.xRange.max - xDeltaUnits,
      ) || didPan;
  }

  for (const [scaleKey, startRange] of panState.yRanges.entries()) {
    const deltaY = event.clientY - panState.startClientY;
    const yUnitsPerPixel = (startRange.max - startRange.min) / rect.height;
    const yDeltaUnits = deltaY * yUnitsPerPixel;
    didPan =
      setFiniteScale(plot, scaleKey, startRange.min - yDeltaUnits, startRange.max - yDeltaUnits) ||
      didPan;
  }

  return didPan;
}

function zoomScalesAroundPosition(
  plot: uPlot,
  left: number,
  top: number,
  rangeMultiplier: number,
  minXRange: number,
  minYRange: number,
): boolean {
  const rect = plot.over.getBoundingClientRect();

  if (rect.width <= 0 || rect.height <= 0 || !Number.isFinite(rangeMultiplier)) {
    return false;
  }

  let didZoom = false;
  const xScale = getFiniteScale(plot, "x");

  if (xScale !== undefined) {
    didZoom =
      setRangeAroundAnchor(
        plot,
        "x",
        plot.posToVal(left, "x"),
        left / rect.width,
        (xScale.max - xScale.min) * rangeMultiplier,
        minXRange,
      ) || didZoom;
  }

  for (const scaleKey of getYScaleKeys(plot)) {
    const yScale = getFiniteScale(plot, scaleKey);

    if (yScale === undefined) {
      continue;
    }

    didZoom =
      setRangeAroundAnchor(
        plot,
        scaleKey,
        plot.posToVal(top, scaleKey),
        getYAnchorRatio(top, rect.height),
        (yScale.max - yScale.min) * rangeMultiplier,
        minYRange,
      ) || didZoom;
  }

  return didZoom;
}

function setRangeAroundAnchor(
  plot: uPlot,
  scaleKey: string,
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
  return setFiniteScale(plot, scaleKey, min, max);
}

function getYAnchorRatio(top: number, height: number): number {
  return 1 - top / height;
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
      setFiniteScale(plot, scaleKey, yScale.min - deltaUnits, yScale.max - deltaUnits) || didPan;
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
