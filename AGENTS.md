# AGENTS.md

## 项目简介

Live Serial Plotter 是一个 VS Code 桌面扩展，用于串口监控、串口文本数据解析，以及在 Webview 中实时绘制多通道曲线。扩展名和包名是 `live-serial-plotter`，显示名是 `Live Serial Plotter`。

首版目标是可运行 MVP，而不是完整串口工作台。当前功能包括串口枚举、连接与断开、发送文本、显示原始串口日志、内置解析器，以及基于 uPlot 的实时折线图。

## 技术栈

- 包管理器：pnpm
- 运行目标：VS Code desktop extension
- Extension Host：TypeScript，打包到 `dist/extension.cjs`
- Webview：Vanilla TypeScript + CSS + uPlot，Vite 打包到 `dist/webview`
- 串口：`serialport`
- 构建：`tsdown` + `vite`
- 测试：`vitest`，VS Code 集成测试使用 `@vscode/test-cli`
- Lint 和格式化：Oxc 工具链，`oxlint` 和 `oxfmt`

## 主要目录

- `src/extension.ts`：扩展激活入口，注册 `liveSerialPlotter.open` 命令。
- `src/panel/LiveSerialPlotterPanel.ts`：Webview panel 生命周期、消息路由和串口会话协调。
- `src/serial/`：串口服务和 UTF-8 行解码。
- `src/parsers/parseLine.ts`：`raw`、`csv`、`jsonl`、`keyValue`、`auto` 解析逻辑。
- `src/session/`：点批处理和环形缓冲。
- `src/shared/protocol.ts`：Extension Host 和 Webview 共享消息协议。
- `webview/src/`：Webview UI、uPlot 图表和样式。
- `tests/unit/`：解析器、缓冲、解码和串口服务单元测试。
- `tests/extension/`：VS Code 扩展激活和命令注册测试。
- `scripts/copy-serial-binding.mjs`：复制 `@serialport/bindings-cpp` native 运行时到 `dist/node_modules`。

## 常用命令

```sh
pnpm install
pnpm fmt:check
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm build
pnpm package
```

`pnpm package` 会通过 `vscode:prepublish` 自动调用 `pnpm build`，一般不需要先手动构建。

## 打包注意事项

`serialport` 依赖 native binding。`tsdown.config.ts` 需要把 `serialport` 的 JS 层 bundle 进 `dist/extension.cjs`，同时保留 `@serialport/bindings-cpp` 为 external。构建后由 `scripts/copy-serial-binding.mjs` 把 native binding 复制到 `dist/node_modules`。

不要从 `.vscodeignore` 中排除 `dist/node_modules/**`。否则安装 VSIX 后扩展激活时可能找不到 native binding，表现为命令 `liveSerialPlotter.open` 无法执行或扩展激活失败。

## 当前约束

- 首版只支持桌面版 VS Code，不支持 VS Code Web。
- Webview 只加载本地打包资源，使用严格 CSP，不执行用户脚本。
- 不配置 Git hooks。
- 不引入 React，Webview 继续使用 Vanilla TypeScript。
- 没有真实串口设备时，测试应使用 mock 或单元测试覆盖核心链路。

## 开发建议

修改 Extension Host 和 Webview 协议时，先更新 `src/shared/protocol.ts`，再同步调整两端消息处理。

修改串口读取、解析或图表数据流时，优先补充 Vitest 单元测试。涉及 VS Code 激活或命令注册时，再补充扩展集成测试。

提交前至少运行：

```sh
pnpm check
pnpm package
```
