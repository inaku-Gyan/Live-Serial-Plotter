import type uPlot from "uplot";

const uPlotPathCacheKey = "_paths";

interface PathCachedSeries extends uPlot.Series {
  [uPlotPathCacheKey]?: unknown;
  points?: uPlot.Series.Points & {
    [uPlotPathCacheKey]?: unknown;
  };
}

export function invalidatePlotPaths(plot: uPlot): void {
  for (const series of plot.series.slice(1) as PathCachedSeries[]) {
    series[uPlotPathCacheKey] = null;

    if (series.points !== undefined) {
      series.points[uPlotPathCacheKey] = null;
    }
  }
}
