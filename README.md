# Live Serial Plotter

Live Serial Plotter is a VS Code desktop extension for monitoring serial ports, parsing telemetry lines, and plotting live numeric data.

## MVP Features

- List serial ports and connect with a selected baud rate.
- View raw serial lines and send text back to the connected port.
- Parse `CSV`, `JSON Lines`, `key=value`, `raw`, or `auto` input modes.
- Plot parsed numeric channels with uPlot in a local VS Code Webview.
- Load JSONC profiles for framing, parser options, output routing, and styling.
- Edit basic profile and pipeline settings from the VS Code sidebar.

## Contributing

Development setup, common commands, debugging, testing, and release notes are
covered in [CONTRIBUTING.md](CONTRIBUTING.md).

Profile and pipeline configuration is covered in
[docs/profiles-and-pipeline.zh-CN.md](docs/profiles-and-pipeline.zh-CN.md).
