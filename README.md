# Live Serial Plotter

Live Serial Plotter is a VS Code desktop extension for monitoring serial ports, parsing telemetry lines, and plotting live numeric data.

## MVP Features

- List serial ports and connect with a selected baud rate.
- View raw serial lines and send text back to the connected port.
- Parse `CSV`, `JSON Lines`, `key=value`, `raw`, or `auto` input modes.
- Plot parsed numeric channels with uPlot in a local VS Code Webview.

## Development

```sh
pnpm install
pnpm build
pnpm test
```

Open the project in VS Code and run the extension launch configuration, or run the command `Live Serial Plotter: Open` from an Extension Development Host.
