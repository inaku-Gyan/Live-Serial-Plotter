# Contributing

## Development

Install dependencies:

```sh
pnpm install
```

Release process documentation is available in
[docs/release.zh-CN.md](docs/release.zh-CN.md).

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

更多测试和串口调试方式见 [测试与调试方式](docs/testing.zh-CN.md)。

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

Open the project in VS Code and run the `Run Extension` launch configuration. It
runs the `pnpm: build` task first, then opens an Extension Development Host.

In the Extension Development Host, run the command `Live Serial Plotter: Open`.
