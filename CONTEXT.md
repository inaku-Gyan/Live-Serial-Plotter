# Live Serial Plotter

Live Serial Plotter is a VS Code desktop tool for turning serial telemetry into
live monitor outputs. This glossary defines the domain concepts and ownership
boundaries used by the repository.

## Monitor concepts

**Monitor Page**:
One independent monitor surface with page controls and an output grid. A page
has its own active profile, layout, connection state, and temporary interaction
state.
_Avoid_: Workspace, Panel (except when referring to the VS Code
`WebviewPanel` API).

**Output Grid**:
The page surface that arranges output tiles and owns page-level layout.
_Avoid_: Output Workspace.

**Output Tile**:
One output surface with placement and framing around one output renderer. A tile
owns geometry and chrome; it does not own the meaning or high-frequency drawing
of its content.
_Avoid_: Output Panel when naming the product concept.

**Output Renderer**:
The content-specific view for one output. A renderer owns its runtime drawing
objects and view state, while remaining unaware of the tile's geometry.
_Avoid_: Output View when referring to the renderer instance.

**Output Kind**:
The declared output category that connects an output configuration to its
runtime packet and renderer. A time-series output is declared as
`timeSeriesLine` and receives `timeSeriesAppend` packets because the declaration
describes the view while the packet describes the update.

**Page Store**:
The low-frequency state for one Monitor Page, including selections, connection
controls, active profile and layout references, and page-level notifications.
It delegates high-frequency output work to the output grid boundary.
_Avoid_: a global monitor store shared by pages.

## Configuration and session concepts

**Profile**:
A reusable declaration of serial codec, framing, parser, output semantics, and
the default layout preset reference. A profile does not own the selected serial
port or the current runtime baud rate.

**Layout Preset**:
A reusable saved set of page, tile, and renderer view defaults referenced by a
profile. It describes how a new Monitor Page starts; it is separate from the
profile's serial and parsing semantics.

**Window Session Override**:
Temporary layout and view changes made inside one open Monitor Page. The changes
remain local until the user explicitly saves them; switching profiles loads the
new profile's default layout and discards an unsaved override.

**Parsed Record**:
The pipeline representation produced after framing and parsing a serial frame,
before output-specific mapping. It contains the parsed fields and source timing
needed to produce output packets.

**Output Packet**:
An ephemeral, output-specific runtime payload sent from the Extension Host to a
Monitor Page after mapping a parsed record. It is not persisted or shared across
pages, and it does not enter deep reactive UI state.

**Pipeline**:
The transformation from serial bytes through codec, framing, parser, and output
mapping until output packets are ready for a Monitor Page.

**Parser**:
A pipeline component that turns a framed serial input into one or more parsed
records according to a built-in or trusted custom parsing mode.

**Time Axis**:
The coordinate used to place time-series samples. It may come from sequence,
host receipt time, a field in the parsed record, or a fixed interval.

## Runtime boundaries

**Extension Host**:
The trusted runtime that owns serial connections, files, persistence, and
coordination across Webviews.

**Webview**:
A local UI surface that presents a Monitor Page or Profile Editor through the
typed shared message contract.

**Shared Protocol**:
The typed contract for messages and data crossing the Extension Host/Webview
boundary. It is the source of truth for the shapes of profiles, layouts, output
packets, and commands.
