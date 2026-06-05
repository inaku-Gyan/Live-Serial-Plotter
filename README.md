# Live Serial Plotter

Live Serial Plotter is a VS Code desktop extension for monitoring serial ports, parsing telemetry lines, and plotting live numeric data.

## MVP Features

- List serial ports and connect with a selected baud rate.
- View raw serial lines and send text back to the connected port.
- Parse `CSV`, `JSON Lines`, `key=value`, `raw`, or `auto` input modes.
- Plot parsed numeric channels with uPlot in a local VS Code Webview.

## Development

Install dependencies:

```sh
pnpm install
```

### Common Commands

Format, lint, and type-check:

```sh
pnpm fmt
pnpm fmt:check
pnpm lint
pnpm lint:fix
pnpm typecheck

# Run all checks above:
pnpm check
```

Run tests:

```sh
pnpm test
pnpm test:extension
```

更多测试和串口调试方式见 [测试与调试方式](docs/testing.md)。

Build:

```sh
pnpm build:extension
pnpm build:webview

# Build both the Extension Host bundle and the Webview assets:
pnpm build
```

Package a local VSIX:

```sh
pnpm package
```

This includes the `pnpm: build` step,
and outputs `live-serial-plotter-<version>.vsix` in the project root.

### VS Code Debugging

Open the project in VS Code and run the `Run Extension` launch configuration. It runs the `pnpm: build` task first, then opens an Extension Development Host.

In the Extension Development Host, run the command `Live Serial Plotter: Open`.
