# UI 重构全量改名与删除对照表

> 配套 [ui-refactor-plan.zh-CN.md](./ui-refactor-plan.zh-CN.md) 的**施工清单**。前提：
>
> - **不考虑任何向后兼容**。旧的 JSONC 布局文件、旧消息、旧字段一律不保留。
> - **彻底重构**：所有相关的类型、类、接口、方法、变量、文件名、CSS 类、schema、测试都改到位，不留半吊子。
> - 表内符号均以当前代码为准，改动时以本表为准，逐条核对。
> - 「未来/grid」标注的行属于 §3.9-A 栅格布局能力，本轮不做，见文末「待确认决策」。

图例：`旧 → 新`；🗑 = 删除；`file:line` 为当前锚点。

---

## A. 协议类型（`src/shared/protocol.ts`）与生成的 schema

| 旧                                | 新                           | 锚点 & 涟漪                                                                                         |
| --------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `OutputViewLayoutConfig`          | `OutputViewStateConfig`      | protocol.ts:711；types.ts、LayoutStore、schema                                                      |
| `TimeSeriesViewLayoutConfig`      | `TimeSeriesViewStateConfig`  | protocol.ts:716；types.ts `PlotScaleRanges`、renderer、schema                                       |
| `TerminalViewLayoutConfig`        | `TerminalViewStateConfig`    | protocol.ts:724；两个 terminal renderer、schema                                                     |
| `FramePlot2dViewLayoutConfig`     | `FramePlot2dViewStateConfig` | protocol.ts:729；frame-plot renderer、schema                                                        |
| `AxisRangeLayoutConfig`           | `AxisRangeStateConfig`       | protocol.ts:739；schema                                                                             |
| `OutputLayoutConfig.view`（字段） | `.viewState`                 | protocol.ts:683；LayoutStore normalize、controller capture、4 renderer、defaultLayout、test harness |
| `ToWebviewMessage` `rawLine`      | 🗑 删除                      | protocol.ts:798（host 从不发送，死消息）                                                            |
| `ToWebviewMessage` `seriesAppend` | 🗑 删除                      | protocol.ts:799（同上）                                                                             |
| `ToExtensionMessage` `clearLog`   | 🗑 删除                      | protocol.ts:771（Clear 改本地，见 F）                                                               |
| `PlotSample`                      | 🗑 删除                      | protocol.ts:25（仅 legacy 链引用，见 F）                                                            |

- ⚠️ 不动：`ToProfileEditorMessage.setProfileEditorView` 里的 `view: "home"|"editor"`（protocol.ts:805）——那是 profile 编辑器的**页面模式**，与输出视图状态无关。
- 改完协议后必须跑 `pnpm schema:generate`，`schemas/layout.schema.json` 会自动把 `view→viewState`、`*ViewLayoutConfig→*ViewStateConfig`、`AxisRangeLayoutConfig→AxisRangeStateConfig` 一并更新（当前定义在 schema:70/74/81/109/122/146/181/195）。

---

## B. Renderer 类与文件（`webview/src/monitor/outputs/`）

| 旧（类 / 文件）                                 | 新（类 / 文件）                                         |
| ----------------------------------------------- | ------------------------------------------------------- |
| `interface OutputView`（types.ts:19）           | `interface OutputRenderer`（types.ts）                  |
| `TimeSeriesLineView` / `time-series/view.ts`    | `TimeSeriesLineRenderer` / `time-series/renderer.ts`    |
| `FramePlot2dView` / `frame-plot/view.ts`        | `FramePlot2dRenderer` / `frame-plot/renderer.ts`        |
| `TerminalAppendView` / `terminal/appendView.ts` | `TerminalAppendRenderer` / `terminal/appendRenderer.ts` |
| `TerminalFrameView` / `terminal/frameView.ts`   | `TerminalFrameRenderer` / `terminal/frameRenderer.ts`   |

`OutputRenderer` 接口方法：

| 旧方法                                                       | 新方法                  | 说明                                                                           |
| ------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------ |
| `applyViewLayout(layout)`                                    | `applyViewState(state)` | 语义：`undefined` = 恢复 config 默认                                           |
| `captureViewLayout()`                                        | `captureViewState()`    | 无可保存交互状态则返回 `undefined`（删掉 FramePlot/TerminalFrame 的回环 stub） |
| `resetView()`                                                | `resetViewState()`      | 统一语义：回到初始声明的视图状态                                               |
| `updateData` / `clearData` / `dispose` / `outputId` / `kind` | 不变                    | —                                                                              |

renderer 内部私有 append 方法（`appendLines` / `appendSamples` / `appendFrame` 等）保持不变；仅 `appendLines`/`appendSamples` 因 legacy 删除而失去外部调用方（见 F），方法本身可留作 `updateData` 内部使用。

---

## C. 输出子系统协调器与构造（`controller.ts` / `factory.ts` / `types.ts`）

| 旧                                                               | 新                                                                | 说明                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| `class MonitorOutputController`（controller.ts:14）              | `class DomOutputGridController`（文件 `outputGridController.ts`） | DOM 实现；未来 grid 落地时拆成 `PacketRouter` + `OutputGrid`(Vue) |
| `interface MonitorOutputAdapter`（store.ts:36）                  | `interface OutputGridController`（移入 types.ts）                 | store 依赖的 port；测试用 fake 实现它                             |
| `MonitorOutputControllerOptions`（types.ts:11）                  | `OutputGridControllerOptions`                                     | —                                                                 |
| `createOutputView()`（factory.ts:9）                             | `createOutputRenderer()`                                          | —                                                                 |
| method `captureSavableViewState()`                               | `captureLayout()`                                                 | 返回 `LayoutConfig`，名字对齐实际语义                             |
| method `resetOutputView(id)`                                     | `resetOutputViewState(id)`                                        | 与 renderer `resetViewState` 对齐                                 |
| `renderOutputs` / `appendPacket` / `resetPageLayout` / `dispose` | 不变                                                              | —                                                                 |
| `appendLegacyRawLine()`（controller.ts:44）                      | 🗑 删除                                                           | 见 F                                                              |
| `appendLegacySeries()`（controller.ts:52）                       | 🗑 删除                                                           | 见 F                                                              |
| `findFirstView()`（controller.ts:129）                           | 🗑 删除                                                           | 仅被上面两个 legacy 方法使用                                      |
| `clearAll()`（controller.ts:60）                                 | 🗑 删除                                                           | 无任何调用方                                                      |

新增：`interface RendererContext { mount; config; viewState; }` + `type RendererFactory = (ctx) => OutputRenderer`，`createOutputRenderer` 统一用它构造（终结 factory 逐 case 特判）。**postMessage 不进 context**（已定）：clearLog 本地化后无 renderer 需要它；`OutputGridControllerOptions` 也一并去掉 `postMessage`（旧 `MonitorOutputControllerOptions` 的 `{ root, postMessage }` → `{ root }`）；`types.ts` 的 `PostMessage` 类型若因此无引用则删除。

---

## D. 页面 Store（`webview/src/monitor/store.ts` / `main.ts`）

| 旧                                                                              | 新                                           |
| ------------------------------------------------------------------------------- | -------------------------------------------- |
| `createMonitorStore()`                                                          | `createPageStore()`                          |
| `type MonitorStore`                                                             | `type PageStore`                             |
| `interface MonitorUiState`                                                      | `interface PageState`                        |
| `interface MonitorPersistedState`                                               | `interface PagePersistedState`               |
| `interface MonitorStoreOptions`                                                 | `interface PageStoreOptions`                 |
| 字段 `outputAdapter`                                                            | `outputGrid`                                 |
| 选项 `createOutputAdapter`                                                      | `createOutputGrid`                           |
| method `mountOutputs()`                                                         | `mountOutputGrid()`（`OutputGrid.vue` 调用） |
| method `resetOutputView()`                                                      | `resetOutputViewState()`                     |
| `handleHostMessage` 里 `rawLine` / `seriesAppend` 分支（store.ts:258-266）      | 🗑 删除                                      |
| `MonitorOutputAdapter.appendLegacyRawLine/appendLegacySeries`（store.ts:39-40） | 🗑 删除（接口移入 types.ts 后不含这两项）    |
| 其余方法（selectProfile / toggleConnection / sendText / saveLayout…）           | 不变                                         |

---

## E. Vue 组件与 CSS（`webview/src/monitor/`、`styles.css`）

| 旧                                                             | 新                                       |
| -------------------------------------------------------------- | ---------------------------------------- |
| `MonitorApp.vue`                                               | `MonitorPage.vue`（main.ts import 同步） |
| `components/OutputWorkspace.vue`                               | `components/OutputGrid.vue`              |
| CSS `.shell`（styles.css:29、MonitorApp 模板）                 | `.monitor-page`                          |
| CSS `.workspace`（styles.css:180/190/194/198/203/404）         | `.output-grid`                           |
| template ref `outputWorkspace`（OutputWorkspace.vue:9/12/19）  | `outputGrid`                             |
| `MonitorToolbar` / `LayoutControls` / `SendRow` / `ErrorToast` | 不改名（页面级 chrome）                  |

- ⚠️ 不动的 “workspace”（属 profile/layout 作用域，非输出区）：MonitorToolbar.vue:43-45 `profile.scope==="workspace"` / `workspaceName`；LayoutControls.vue:12 报错文案。
- store 传递从 prop 改 provide/inject（`MonitorStoreKey` 等）属计划阶段 B，不在本表逐组件列。

---

## H. `panel → tile` 全量改名（本轮一步到位）

概念框统一为 `OutputTile`，DOM / 数据 / schema 同步 tile 化。

| 旧                                       | 新                         | 锚点 & 涟漪                                                                           |
| ---------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| `OutputPanelLayoutConfig`                | `OutputTileLayoutConfig`   | protocol.ts:686；schema、LayoutStore、types                                           |
| `OutputLayoutConfig.panel`（字段）       | `.tile`                    | protocol.ts:679；LayoutStore、controller、factory、defaultLayout、schema、tests       |
| 目录 `outputs/panel/`                    | `outputs/tile/`            | 含 `layout.ts`、`chrome.ts`                                                           |
| `applyPanelLayout()`                     | `applyTileLayout()`        | layout.ts:42；controller.ts:82、factory.ts:19                                         |
| `createPanelHeader()`                    | `createTileHeader()`       | chrome.ts:3；4 个 renderer 调用                                                       |
| `appendPanelHeaderButton()`              | `appendTileHeaderButton()` | chrome.ts:30；renderer 调用                                                           |
| `getPanelHeaderActions()`（内部）        | `getTileHeaderActions()`   | chrome.ts:46                                                                          |
| `sortOutputsByLayout` 内 `.panel?.order` | `.tile?.order`             | layout.ts:34-35                                                                       |
| `normalizePanelLayout()`                 | `normalizeTileLayout()`    | LayoutStore.ts:426；`normalizeOutputLayout` 解析 `value.panel→value.tile`（:412/416） |
| CSS `.output-panel`                      | `.output-tile`             | styles.css:208                                                                        |
| CSS `.output-panel-${kind}`（4 个 kind） | `.output-tile-${kind}`     | styles.css:216-222；factory.ts:16 拼接                                                |
| defaultLayout `panel:`                   | `tile:`                    | defaultLayout.ts:14/25                                                                |

⚠️ **保持不变**：`.output-header` / `.output-title-block` / `.output-header-actions` / `.output-reset-button`（属 "output header" 系，非 panel 框类）；VS Code 主题变量 `--vscode-panel-border` / `--vscode-panel-background` 等。

---

## F. 删除清单（no-compat，整条 legacy 数据链）

生产链路是 `SerialService → onOutputPacket → OutputPacketBatcher → outputPacket`。下列全部是被它取代的死代码：

| 删除项                                                                                 | 位置                           | 备注                                           |
| -------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------- |
| `ToWebviewMessage.rawLine` / `seriesAppend`                                            | protocol.ts:798-799            | host 从不发送                                  |
| `PlotSample`                                                                           | protocol.ts:25                 | 仅 legacy 引用                                 |
| `ToExtensionMessage.clearLog`                                                          | protocol.ts:771                | Clear 改本地                                   |
| controller `appendLegacyRawLine` / `appendLegacySeries` / `findFirstView` / `clearAll` | controller.ts:44/52/129/60     | —                                              |
| store 的 `rawLine` / `seriesAppend` 处理 + adapter legacy 方法                         | store.ts:39-40/258-266         | —                                              |
| terminal Clear → `postMessage({type:"clearLog"})`                                      | appendView.ts:36               | 改为本地 `clearData()`                         |
| panel `clearLog` 空处理分支                                                            | LiveSerialPlotterPanel.ts:161  | 随消息删除                                     |
| **（host 侧，本轮删）** `SerialService.onRawLine` / `onSample`                         | SerialService.ts:34-35/301/307 | 生产未接线，仅 SerialService.test 用 onRawLine |
| **（host 侧，本轮删）** `PointBatcher` 整个文件                                        | session/PointBatcher.ts        | 无生产调用                                     |
| **（host 侧，本轮删）** `toPlotSample`                                                 | parsers/parseLine.ts:185       | 无生产调用                                     |

---

## G. 测试改动（`tests/unit/`）

| 文件                                                  | 改动                                                                                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `monitor-outputs/helpers/monitorOutputTestHarness.ts` | `MonitorOutputController→DomOutputGridController`（:8/215/226）；`createLayout` 的 `["view"]→["viewState"]`（:234）                                             |
| `monitor-outputs/controller.test.ts`                  | 类名 + 方法名同步                                                                                                                                               |
| `monitor-outputs/timeSeries.test.ts`                  | `TimeSeriesLineView→…Renderer`、`applyViewLayout/captureViewLayout/resetView→…State`                                                                            |
| `monitor-outputs/framePlot2d.test.ts`                 | `FramePlot2dView→…Renderer` + 方法名                                                                                                                            |
| `monitorStore.test.ts`                                | 删 `rawLine`/`seriesAppend`/`appendLegacy*` 用例（:163-171/238-253）；`adapter→outputGrid`、`createOutputAdapter→createOutputGrid`、`MonitorStore→PageStore` 等 |
| `monitorVue.test.ts`                                  | 删 `appendLegacy*` mock（:270-285）；同步类型/字段改名                                                                                                          |
| `SerialService.test.ts`                               | 若删 `onRawLine`（见 F），把 :116-132 的断言改走 `onOutputPacket`                                                                                               |

---

## 已确认决策（2026-07-04）

1. **`panel → tile`：本轮一步到位。** 全量改名见 §H（数据结构 / 目录 / 函数 / CSS / schema / LayoutStore / defaultLayout 全部 tile 化）。
2. **`RendererContext.postMessage`：去掉。** clearLog 已本地化，无 renderer 需要 postMessage；连带 `OutputGridControllerOptions` 也去掉 postMessage（见 §C）。
3. **host 侧 legacy：一并删。** `onRawLine` / `onSample` / `PointBatcher` / `toPlotSample` 全删（见 §F），`SerialService.test` 相关断言改走 `onOutputPacket`。
