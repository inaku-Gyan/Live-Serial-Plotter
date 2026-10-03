# Vue shell with imperative high-frequency renderers

Live Serial Plotter has low-frequency page and form state alongside sustained
serial output. We use Vue for the low-frequency UI shell and typed composable
stores, while each Output Renderer owns its imperative DOM, uPlot, canvas, or
terminal runtime and receives Output Packets outside deep reactive state. This
keeps ordinary UI state easy to compose without making the high-frequency path
pay for reactive tree updates; a fully reactive chart state and a fully
hand-built UI were rejected because they make one of the two workloads harder to
control.
