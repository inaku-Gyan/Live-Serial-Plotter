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

Build both the Extension Host bundle and the Webview assets:

```sh
pnpm build
```

Build only one side:

```sh
pnpm build:extension
pnpm build:webview
```

Format, lint, and type-check:

```sh
pnpm fmt
pnpm fmt:check
pnpm lint
pnpm lint:fix
pnpm typecheck
pnpm check
```

Run tests:

```sh
pnpm test
pnpm test:extension
```

Package a local VSIX:

```sh
pnpm package
```

The generated package is written to `live-serial-plotter-0.0.1.vsix`.

Install the local VSIX into VS Code:

```sh
code --install-extension live-serial-plotter-0.0.1.vsix --force
```

Uninstall the local extension when needed:

```sh
code --uninstall-extension inaku.live-serial-plotter
```

### VS Code Debugging

Open the project in VS Code and run the `Run Extension` launch configuration. It runs the `pnpm: build` task first, then opens an Extension Development Host.

In the Extension Development Host, run the command `Live Serial Plotter: Open`.
