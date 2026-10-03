# Live Serial Plotter

Live Serial Plotter is a VS Code desktop extension for monitoring serial ports, parsing telemetry lines, and plotting live numeric data.

## MVP Features

- List serial ports and connect with a selected baud rate.
- View raw serial lines and send text back to the connected port.
- Parse `CSV`, `JSON Lines`, `key=value`, `raw`, or `auto` input modes.
- Plot parsed numeric channels with uPlot in a local VS Code Webview.
- Load JSONC profiles for text codec, framing, parser options, output routing, and styling.
- Edit basic profile and pipeline settings from the VS Code sidebar.

## Documentation

Use these stable documents as the repository map:

- [AGENTS.md](AGENTS.md) — repository workflow, code standards, and release gates.
- [CONTEXT.md](CONTEXT.md) — domain vocabulary and runtime ownership boundaries.
- [Architecture](docs/architecture.zh-CN.md) — current runtime structure and data flow.
- [Profile and pipeline](docs/profiles-and-pipeline.zh-CN.md) — configuration and parsing behavior.
- [Testing](docs/testing.zh-CN.md) — unit, extension, simulated serial, and E2E checks.
- [Release](docs/release.zh-CN.md) — versioning and publishing workflow.
- [Agent issue tracker](docs/agents/issue-tracker.md) — GitHub Issue operations.
- [Agent triage labels](docs/agents/triage-labels.md) — category and state labels.
- [Agent domain rules](docs/agents/domain.md) — source-of-truth layers and terminology pointers.
- [Architecture decisions](docs/adr/) — decisions that are costly to reverse.
