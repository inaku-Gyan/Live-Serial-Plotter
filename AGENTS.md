# AGENTS.md

## 项目简介

Live Serial Plotter 是一个 VS Code 桌面扩展，用于串口监控、串口文本数据解析，以及在 Webview 中实时绘制多通道曲线。扩展名和包名是 `live-serial-plotter`，显示名是 `Live Serial Plotter`。

首版目标是可运行 MVP，而不是完整串口工作台。当前功能包括串口枚举、连接与断开、发送文本、显示原始串口日志、内置解析器，以及基于 uPlot 的实时折线图。

## 技术栈

- 包管理器：pnpm
- 运行目标：VS Code desktop extension
- Extension Host：TypeScript，打包到 `dist/extension.cjs`
- Webview：监控页使用 Vanilla TypeScript + CSS + uPlot；Sidebar Profile UI 使用 Vue 3；Vite 打包到 `dist/webview`
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
- `webview/src/`：Webview UI、uPlot 图表、Vue sidebar profile editor 和样式。
- `tests/unit/`：解析器、缓冲、解码和串口服务单元测试。
- `tests/extension/`：VS Code 扩展激活和命令注册测试。
- `scripts/copy-serial-binding.mjs`：复制 `@serialport/bindings-cpp` native 运行时到 `dist/node_modules`。

## 代码规范

- 优先保持模块化。避免把 UI 状态、DOM 事件、VS Code 消息、串口数据处理和图表更新继续堆在同一个大文件里；新增功能时按职责拆分，例如 Webview bridge、连接控件、日志面板、uPlot 图表、图例和持久化状态。
- 协议类型优先。Extension Host 和 Webview 之间新增消息时，先更新 `src/shared/protocol.ts` 的 discriminated union，再同步调整两端处理逻辑；不要在消息链路中使用 `any` 或未校验的自由对象。
- 保持串口、解析、缓冲和 UI 解耦。串口读取、行解码、文本解析、点批处理和图表展示应各自独立，核心逻辑要能脱离 VS Code Webview 做单元测试。
- Vue 3 只用于适合状态驱动的配置 UI。Sidebar profile editor 使用 typed composable store，不引入 Pinia；未来当状态跨多个页面或实体明显膨胀时再评估 Pinia。
- uPlot 走命令式高性能路径。图表实例和大批量点数据不要放进深层响应式状态；即使监控页未来迁移到 Vue 3，也应只让框架管理 UI 状态，uPlot 实例和数据数组使用非响应式引用管理。
- 高频数据更新必须批处理。不要每收到一个点就重建图表或触发 DOM 列表渲染；优先通过 `PointBatcher`、环形缓冲和数组原地更新控制刷新频率。
- 只在必要时重建 uPlot。新增/删除通道或图表结构性配置变化时可以重建；普通数据追加使用 `setData()`，通道显示切换使用 `setSeries()`，尺寸变化使用 `setSize()`。
- 控制内存和分配。持续运行场景必须保留最大点数和最大日志行数限制；热路径中减少临时对象、重复排序和整表重算，避免长时间串口输出导致 Webview 卡顿。
- Webview UI 使用 VS Code 主题变量和本地打包资源。保持严格 CSP，不加载远程脚本，不执行用户脚本；样式应兼容浅色/深色主题并避免固定品牌色主导界面。
- 测试覆盖风险路径。修改 parser、串口读取、缓冲、批处理或图表数据变换时优先补充 Vitest 单元测试；涉及扩展激活、命令注册或 Webview panel 生命周期时补充 VS Code 集成测试。

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

## 发包流程

每次准备发布 `vX.Y.Z` 时按下面流程处理，不要只改版本号：

1. 确认工作区状态，先运行 `git status --short`，避免把无关改动混入 release commit。
2. 将 `package.json` 中的 `version` 改为 `X.Y.Z`。
3. 更新 `CHANGELOG.md`，在顶部新增 `## X.Y.Z` 小节，记录本次面向用户的功能、修复、构建或测试变化。
4. 检查 `docs/release.zh-CN.md` 的发布规则是否仍然适用，尤其是 prerelease/stable 条件和 tag 命名。
5. 运行 `pnpm check`，必须通过格式、lint、类型检查和单元测试。
6. 运行 `pnpm package`，确认 VSIX 能成功生成，并留意输出文件名是否包含目标版本号。
7. 再次运行 `git status --short`，确认 release commit 只包含预期文件；通常只应包含 `package.json`、`CHANGELOG.md`，以及确实必要的发布说明或配置文件。
8. 提交 release commit，建议格式为 `chore: release vX.Y.Z`。
9. 创建同名 tag：`git tag vX.Y.Z`。tag 名必须和 `package.json.version` 完全对应。
10. 推送时同时推送 commit 和 tag；如果使用 CI 发布，确认对应 workflow 已从 tag 正确触发。

## 当前约束

- 首版只支持桌面版 VS Code，不支持 VS Code Web。
- Webview 只加载本地打包资源，使用严格 CSP，不执行用户脚本。
- 不配置 Git hooks。
- 不引入 React。监控页继续使用 Vanilla TypeScript；sidebar profile editor 使用 Vue 3。
- 没有真实串口设备时，测试应使用 mock 或单元测试覆盖核心链路。

## 开发建议

修改 Extension Host 和 Webview 协议时，先更新 `src/shared/protocol.ts`，再同步调整两端消息处理。

修改串口读取、解析或图表数据流时，优先补充 Vitest 单元测试。涉及 VS Code 激活或命令注册时，再补充扩展集成测试。

提交前至少运行：

```sh
pnpm check
pnpm package
```
