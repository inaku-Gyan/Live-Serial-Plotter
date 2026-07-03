# UI 重构落地计划

> 本文件是**可执行计划**，与 [ui-architecture-roadmap.zh-CN.md](./ui-architecture-roadmap.zh-CN.md)（长期**路线图**）互补：
> 路线图负责定方向和约束，本文件负责定"这一轮到底改什么、怎么验收、怎么提交"。
>
> 核心目标有两个：
>
> 1. 修掉当前 UI 层几处具体的架构味道（store 传递方式、单体表单、宿主端重复、renderer 性能/内存）。
> 2. **重新设计监视页的 UI 契约**——把不同层次的概念命名、定义、层级关系、状态传递方式一次性理清，并为两项未来能力（页面内栅格自由布局、跨页面共享状态）**预留扩展点**（见第 3 节，本轮重点）。
>
> **本轮原则：不考虑任何向后兼容，重构必须彻底。** 所有相关的类型、类、接口、方法、变量、文件名、CSS 类、schema、测试全部改到位；旧 JSONC 布局 / 旧消息 / 旧字段 / legacy 数据链一律删除，不保留。**完整的逐符号对照与删除清单见配套的 [ui-refactor-rename-table.zh-CN.md](./ui-refactor-rename-table.zh-CN.md)**（施工时以它为准）。

---

## 0. 开发要求（贯穿所有阶段，必须遵守）

- **适时 commit**：每个阶段、或阶段内可独立验证的一小步完成后就提交，不要把多阶段改动堆成一个巨型 commit。一个 commit 只做一件语义完整的事。
- **commit message 不带 co-author**：不要在 commit message 里附加 `Co-Authored-By` / co-author 尾注（覆盖默认约定）。message 保持项目现有风格（`refactor:` / `chore:` / `fix:` 等前缀 + 简洁描述）。
- **分支**：在当前 `refactor/ui` 分支上进行。
- **每步验证**：
  - 单层改动完成后至少跑对应单元测试（`pnpm test`）。
  - 跨层边界改动收尾跑 `pnpm check`（fmt + lint + typecheck + test）。
  - 改到打包资源、入口产物名或 native binding 时额外跑 `pnpm package`。
- **不可回退的约束**（每步都要守住）：
  - 严格 CSP，只加载本地打包资源，不执行用户脚本。
  - `dist/webview/assets/index.js`、`index.css`、`profile.js`、`profile.css` 加载路径不变。
  - 高频 `outputPacket` 路径**绝不进入 Vue 响应式**。
  - 保留最大点数 / 最大日志行数上限。
- **测试策略**：以行为和架构约束为准，不以旧测试文件形状为准。可以移动/改写测试，但必须保留等价的行为覆盖（见路线图 §8）。

---

## 1. 现状评估摘要

架构骨架良好（宿主/Webview 边界清晰、协议集中、命令式 renderer 零 Vue 泄漏、helper 分层正确；多页面已原生支持，见 §3.9-B）。问题集中在下列具体点：

| #   | 问题                                                                                                                                                                   | 位置                                                                                                                                                             | 层        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | 整包 `store` 当 prop 逐层传，模板里到处 `store.x.value`（`state.x` 又不用），易漏 `.value` 造成静默 bug                                                                | [MonitorToolbar.vue:105](../webview/src/monitor/components/MonitorToolbar.vue#L105)、[SendRow.vue:24](../webview/src/monitor/components/SendRow.vue#L24)         | Vue 外壳  |
| 2   | `EditorPage.vue` 454 行单体表单，违背路线图 §3"不堆在单文件"目标                                                                                                       | [EditorPage.vue](../webview/src/profile-editor/components/EditorPage.vue)                                                                                        | Vue 外壳  |
| 3   | 模板里 `terminalPatch()/timeSeriesPatch()` 反复 O(n) `.find()`，且在模板内 `throw`                                                                                     | [EditorPage.vue:36-58](../webview/src/profile-editor/components/EditorPage.vue#L36-L58)                                                                          | Vue 外壳  |
| 4   | `getNonce()`/`formatError()`/`getHtml()` 在两个 host 文件几乎逐字重复                                                                                                  | [LiveSerialPlotterPanel.ts:295](../src/panel/LiveSerialPlotterPanel.ts#L295)、[ProfileConfigViewProvider.ts:252](../src/panel/ProfileConfigViewProvider.ts#L252) | 宿主/桥接 |
| 5   | `.button` / reset / body 主题变量在两个 CSS 文件重复                                                                                                                   | [styles.css](../webview/src/styles.css)、[profileEditor.css](../webview/src/profileEditor.css)                                                                   | 样式      |
| 6   | `OutputView` 契约语义不统一：`resetView` 两套含义；`captureViewLayout` 仅 TimeSeries 承重、其余是回环 stub；构造签名不一致（仅 TerminalAppend 需 `postMessage`）       | [types.ts:19](../webview/src/monitor/outputs/types.ts#L19)、[factory.ts:24](../webview/src/monitor/outputs/factory.ts#L24)                                       | Renderer  |
| 7   | terminal 每 packet 整表重拼 + 全量 `textContent`；`TerminalFrameView.frames` Map 无上限（内存泄漏）；FramePlot 每帧 `getComputedStyle` + `Math.min(...allPoints)` 展开 | [appendView.ts:67](../webview/src/monitor/outputs/terminal/appendView.ts#L67)、[frameView.ts:15](../webview/src/monitor/outputs/terminal/frameView.ts#L15)       | Renderer  |
| 8   | `profileEditor.ts` / `profileEditorModel.ts` / `profileEditor.css` 平铺在 `webview/src/` 根，与 `profile-editor/` 目录不对称                                           | [webview/src/](../webview/src/)                                                                                                                                  | 组织      |

**大但不用动**：`interactions.ts`（865 行，纯函数 + 单向依赖 + 单一职责）、`view.ts`（628 行，follow 状态机本身复杂但已合理拆分）。可选拆分，非架构债。

---

## 2. 目标与非目标

**目标**

- 监视页概念模型（命名 / 定义 / 层级 / 状态传递）有一份清晰、正式、可作为后续开发依据的定义（第 3 节）。
- 消灭 Vue 外壳的 `store` 整包传递与 `.value` 泄漏。
- 统一 renderer 契约语义与构造依赖，为未来新增 renderer（histogram / scatter / gauge）铺路。
- 去除宿主端与样式的重复样板。
- 修掉 renderer 层真实的性能/内存问题。
- **概念模型为两项未来能力预留扩展点，且保证是"加法式"接入**（§3.9）：① 页面内栅格平铺自由布局；② 跨页面共享状态管理。

**非目标（本轮不做，仅留缝）**

- **不实现**页面内栅格平铺的自由拖拽/缩放引擎——只保证层边界和数据结构不挡路（§3.9-A）。
- **不实现**跨页面共享状态管理——只在 Host 侧留位置（§3.9-B）。
- 不引入 renderer registry 的完整插件系统（先把契约和构造统一，registry 留作触发条件满足后再评估）。
- 不引入 Pinia、不引入全局 event bus、不引入 React。
- 不改高频 `outputPacket` 协议语义。
- 不做记录/导出/回放/暂停等新能力（属路线图后续阶段）。

---

## 3. 监视页概念模型重新设计（本轮重点）

### 3.1 两个命名问题

**问题 A：`view` 一词三义。**

| 现名                                                                           | 实际含义                                             |
| ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `OutputView`（[types.ts:19](../webview/src/monitor/outputs/types.ts#L19)）     | **渲染器实例**（持有 uPlot/canvas/DOM 的命令式对象） |
| `OutputLayoutConfig.view`（[protocol.ts:683](../src/shared/protocol.ts#L683)） | 一个输出的**已保存视图状态**                         |
| `OutputViewLayoutConfig`（[protocol.ts:711](../src/shared/protocol.ts#L711)）  | 上述视图状态的**类型**                               |

**问题 B：`MonitorOutputController` / `MonitorOutputAdapter` 一角色两名**（store 里叫 `outputAdapter`，实体叫 `Controller`），且这个名字读起来像"页面宿主"，实际它只是**页面内输出区的管理器**（每页面 1 个）。"页面"这一层根本没被命名。

概念一乱，契约语义（`resetView` 重置到哪、`captureViewLayout` 该返回什么）、以及"页面/输出区/面板"的边界就都说不清。

### 3.2 目标概念词表（每层一个名字 + 一句定义）

| 层级     | 目标概念名                            | 定义                                                                                                                   | 运行时归属             |
| -------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 页面     | **MonitorPage**                       | 一个独立 webview 实例，1:1 对应 host 的 `LiveSerialPlotterPanel`；含全部 chrome + 一个输出区；可随时新建、状态互不共享 | Vue app root（概念层） |
| 页面状态 | **PageStore**（今 `monitor store`）   | 低频页面状态：选择项/连接/toast **＋ 面板清单和几何**                                                                  | Vue reactive           |
| 输出区   | **OutputGrid**                        | 页面内**只放输出面板**的那块区域；未来栅格自由布局的接入层（几何、拖拽、缩放、吸附）                                   | Vue 组件（＋布局引擎） |
| 面板     | **OutputTile**                        | 一个面板框（标题栏＋chrome＋未来的拖拽/缩放手柄），内含一个 renderer，持有几何                                         | Vue 组件               |
| 路由     | **PacketRouter**                      | 高频路由：`Map<outputId, renderer>`，`store.appendPacket → router → renderer.updateData`，**绕开 Vue**                 | 命令式非响应式         |
| 渲染器   | **OutputRenderer**（今 `OutputView`） | 只画面板**内容区**（uPlot/canvas/terminal），不管框和几何                                                              | 命令式                 |

> **为什么不叫 Workspace**：`Workspace` 会和 VS Code 自己的 `vscode.workspace`（用户打开的项目文件夹）撞名，在扩展代码里极易误解；改用 `OutputGrid`（并与面板 `OutputTile` 组成 "grid of tiles" 一对）。
>
> **页面 vs 输出区**：`MonitorPage` 是整个 webview（工具栏、发送栏、错误提示 + 一个输出区）；`OutputGrid` 只是其中放面板的那块画布。拖拽/缩放只发生在 `OutputGrid` 内，不碰页面级 chrome。是包含关系：MonitorPage ⊃ OutputGrid ⊃ OutputTile ⊃ OutputRenderer。
>
> **本轮 vs 目标**：本轮把 `MonitorOutputController`+`MonitorOutputAdapter` 合并改名为 **`OutputGridController`**（store 字段 `outputGrid`），并统一 renderer 契约；**暂不**把面板拆进 Vue、**暂不**做 `PacketRouter` 独立化。上表的 `OutputGrid`(Vue)/`OutputTile`(Vue)/`PacketRouter` 是"栅格自由布局落地时"的目标形态，本轮只保证不挡路（§3.9-A）。

### 3.3 层级与所有权

```txt
每次执行 liveSerialPlotter.open ⇒ 新建一个 MonitorPage（互相独立）

           ┌─ (未来) Host 侧跨页面注册表 MonitorPageRegistry (§3.9-B)
           │       页面编号 / 全局控制 / 页面跳转；种子=activePanels + nextPanelId
           ▼
MonitorPage = WebviewPanel
├─ host 侧: LiveSerialPlotterPanel      ← "页面"在 host 的实体
└─ webview 侧: 一个 Vue app (main.ts)
     ├─ PageStore ── provide/inject ──▶ Vue shell 组件（工具栏/发送栏/…）
     │                                    └─ OutputGrid ─(v-for)─▶ OutputTile
     ├─ PacketRouter (非响应式) ──▶ OutputRenderer(每 kind 一个, 命令式)
     └─ 高频 packet: PageStore.appendPacket → PacketRouter → renderer.updateData（不经 Vue）
```

| 概念                                | 拥有的状态                                                                          | 只与谁通信                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Extension Host                      | 串口连接、profile/layout 文件、script trust                                         | 通过 messages 与各 Webview                            |
| PageStore                           | 选择项/连接/toast、active profile/layout 快照、**面板清单+几何**、持有 PacketRouter | 收 host message；`provide` 给组件；驱动路由           |
| Vue shell / OutputGrid / OutputTile | 仅低频 UI 与面板几何（组件局部或 PageStore）                                        | `inject` PageStore                                    |
| PacketRouter                        | `Map<outputId, OutputRenderer>`                                                     | 被 PageStore 调用；转发给 renderer                    |
| OutputRenderer                      | uPlot / canvas / DOM 实例 + **运行时视图状态**                                      | 被 PacketRouter/面板调用；`postMessage`（经 context） |

### 3.4 每个输出的三条正交轴

一个输出（如一张时序图）同时被三种互不相同的东西描述，命名上必须区分：

| 描述            | 类型                                  | 频率 | 进 Vue 响应式？  | 产生方                         | 消费方                                        |
| --------------- | ------------------------------------- | ---- | ---------------- | ------------------------------ | --------------------------------------------- |
| **规格 spec**   | `OutputConfig`                        | 静态 | 快照可以         | profile 声明                   | 面板/Renderer 构造                            |
| **数据 data**   | `OutputPacket`                        | 高频 | **否（硬约束）** | 串口 → host                    | `Renderer.updateData`                         |
| **布局 layout** | `OutputLayoutConfig`＝`panel`＋`view` | 低频 | 快照可以         | layout preset / 运行时 capture | OutputGrid 应用 `panel`；Renderer 应用 `view` |

**关键约束（这是为栅格自由布局留余地的核心）**：`panel`（几何/摆放）归 **OutputGrid/OutputTile** 管，**对 OutputRenderer 完全不可见**；renderer 只通过 ResizeObserver 感知"内容盒变了"，不关心为什么变。→ 以后 `panel` 从 grid-flow 换成栅格坐标，renderer 一行都不用改。

### 3.5 OutputRenderer 契约（重新定义 + 统一语义）

```ts
interface OutputRenderer {
  readonly outputId: string;
  readonly kind: OutputConfig["kind"];

  // 向下：注入运行时数据（高频；忽略不匹配 kind 的 packet）
  updateData(packet: OutputPacket): void;
  clearData(): void;

  // 视图状态三件套（语义必须统一，见下）
  applyViewState(state: OutputViewLayoutConfig | undefined): void;
  resetViewState(): void;
  captureViewState(): OutputViewLayoutConfig | undefined;

  dispose(): void;
}
```

**统一语义（正式约定，写进接口注释）**：

- `applyViewState(state)`：把一份视图状态应用到运行时；`state === undefined` 表示**恢复 config 默认视图**。
- `resetViewState()`：等价于"回到该 renderer **初始声明的视图状态**"（构造时传入的 `viewState`，若无则 config 默认）。**终结当前两套语义**——今天 terminal 走 `applyViewLayout(undefined)`、TimeSeries/FramePlot 走 `applyViewLayout(this.viewLayout)`，语义相反，必须统一到"初始声明"。
- `captureViewState()`：仅当 renderer 真的持有**运行期可变且值得保存**的交互状态时返回具体对象；否则返回 `undefined`。**禁止把构造入参原样回吐**（今天 FramePlot / TerminalFrame 的回环 stub 删除，直接返回 `undefined`）。

> 命名说明：一旦渲染器实例改名 `OutputRenderer`，`view` 不再指实例，`OutputViewLayoutConfig` / `.view` 就统一表示"视图状态"，三义塌陷即解除；方法名同步 `*ViewLayout → *ViewState`。**注意**：`view`（renderer 内容级视图状态）与 `panel`（OutputGrid 面板级几何）是两回事，不要混。

### 3.6 RendererContext（统一构造依赖）

当前 factory 逐 case 特判参数（仅 `TerminalAppendView` 要 `postMessage`）。统一为一个 context 对象：

```ts
interface RendererContext {
  mount: HTMLElement; // 面板内容区容器（面板框由 OutputGrid/OutputTile 提供）
  config: OutputConfig;
  viewState: OutputViewLayoutConfig | undefined;
  postMessage: PostMessage; // 统一提供给所有 renderer
  // 预留：theme accessor、shared services…
}

type RendererFactory = (ctx: RendererContext) => OutputRenderer;
```

这是未来 `Map<kind, RendererFactory>` registry 的前提：构造签名统一后，[factory.ts](../webview/src/monitor/outputs/factory.ts) 的 `switch` 才能平滑换成 registry 查表（本轮**不做** registry，只统一构造）。

### 3.7 状态传递规则

- **向下（config / data）**：Host → messages → PageStore → `OutputGridController.renderOutputs(configs, layout)` → 每个 renderer 经 `RendererContext` 构造。高频 packet：`PageStore.appendPacket` → 路由（本轮在 `OutputGridController` 内、未来独立成 `PacketRouter`）→ `renderer.updateData(packet)`，**全程不经过 Vue**。
- **向上（capture）**：用户点 Save Layout → `PageStore.saveLayout` → 聚合每个 `renderer.captureViewState()`（`view`）+ 面板 `panel` 几何 → 组装 `LayoutConfig` → message 上报 Host。
- **组件取状态**：PageStore 通过 `provide(MonitorStoreKey, store)` 注入一次；组件 `const store = useMonitorStore()` 后，在 `<script setup>` **顶层解构**需要的 computed（`const { baudRateValid, connectDisabled } = store`），模板中直接用，ref 自动解包，**彻底消灭 `.value`**。

### 3.8 命名迁移对照表

> ⚠️ **完整逐符号对照与删除清单以配套的 [ui-refactor-rename-table.zh-CN.md](./ui-refactor-rename-table.zh-CN.md) 为准。** 因本轮 no-compat，下表「本轮做？」列中原标"后置/可选/留缝(命名)"的 protocol 改名（`view→viewState` 等）与 legacy 删除**均已纳入本轮**；`panel→tile` 改名也已并入本轮（对照表 §H）。仅 §3.9 的栅格**拖拽/缩放功能**与跨页面**共享状态功能**仍不实现（`MonitorPageRegistry` 仍是占位）。

| 现名                                                           | 目标名                                                          | 本轮做？ | 影响面                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------- | -------- | --------------------------------------- |
| `OutputView`（实例）                                           | `OutputRenderer`                                                | ✅       | 仅 webview                              |
| `MonitorOutputController` / `MonitorOutputAdapter`（两名一物） | 合并为 `OutputGridController`                                   | ✅       | 仅 webview                              |
| store 字段 `outputAdapter`                                     | `outputGrid`                                                    | ✅       | 仅 webview                              |
| 方法 `applyViewLayout` / `captureViewLayout` / `resetView`     | `applyViewState` / `captureViewState` / `resetViewState`        | ✅       | 仅 webview                              |
| 组件 `OutputWorkspace.vue` / CSS `.workspace`                  | `OutputGrid.vue` / `.output-grid`                               | ✅       | 仅 webview                              |
| `monitor store`（概念）                                        | `PageStore`（`createMonitorStore` 函数名可保留）                | 文档为主 | 仅 webview                              |
| `OutputGridController`（本轮产物）                             | 未来拆为 `OutputGrid`(Vue) + `OutputTile`(Vue) + `PacketRouter` | ❌ 留缝  | 栅格自由布局落地时（§3.9-A）            |
| —（无）                                                        | `MonitorPageRegistry`（Host 侧跨页面）                          | ❌ 留位  | 跨页面状态落地时（§3.9-B）              |
| `OutputViewLayoutConfig` / `.view`                             | （可选）`OutputViewStateConfig` / `.viewState`                  | ❌ 后置  | **ripples 到 protocol + schema + 测试** |

### 3.9 预留扩展点（本轮不实现，只留余地）

#### A. 页面内栅格平铺自由布局

- **目标**：面板可拖动/缩放，以栅格单元为步长（snap-to-grid、不重叠、可回流）。
- **落地层**：`OutputGrid`（画布/布局引擎）+ `OutputTile`（面板框携带拖拽/缩放手柄）。届时面板框迁入 Vue（`v-for` + `:key="outputId"` 保证 renderer 不被重建），高频路由抽成独立 `PacketRouter`。
- **数据结构**：`OutputPanelLayoutConfig`（今 `order/columnSpan/minHeight`）演进为几何 `PanelGeometry { col, row, width, height }`（栅格单位）＋ `minWidth/minHeight/collapsed/maximized`；页面级 `MonitorPageLayoutConfig`（今 `columns/density`）演进为栅格参数（列数/行高/间距）。`OutputLayoutConfig = { panel, view }` 结构不变。
- **本轮如何留余地（三条硬约束）**：
  1. 面板几何对 renderer 不可见（§3.4）——renderer 只画内容，换布局范式不碰 renderer。
  2. `OutputGrid` 作为独立一层存在（哪怕本轮实现仍是薄薄的 CSS grid-flow applier）——它就是引擎接入缝；不要退回"一把抓"的 controller。
  3. 面板级手势与内容级手势分层：面板拖拽/缩放归 OutputGrid/OutputTile；图内 pan/zoom 归 renderer（[interactions.ts](../webview/src/monitor/outputs/time-series/interactions.ts)）。本轮不写面板手势，但边界先划好。

#### B. 跨页面共享状态管理

- **目标**：一份**小而少用**的跨页面状态——页面编号、全局页面控制、页面跳转等。
- **落地层**：只在 **Extension Host**（唯一跨 webview 的协调者；路线图定调"多 Webview 协调通过 Host 和消息协议完成"）。webview 之间**不直接共享**，一律走 Host + 消息协议。
- **现有种子**：[LiveSerialPlotterPanel.activePanels](../src/panel/LiveSerialPlotterPanel.ts#L29)（静态 Set）+ `nextPanelId` 已是雏形；未来收敛成一个 `MonitorPageRegistry`（页面清单/编号/跳转入口），不散落。
- **本轮如何留余地**：page 相关消息仍走 `src/shared/protocol.ts` 判别联合；不在 webview 侧引入任何跨页面全局单例；`MonitorPage` 概念保持"自足、可独立创建"，跨页面能力是 Host 加法。

---

## 4. 分阶段执行计划

> 顺序建议：A（热身、零风险）→ B（你最在意的）→ C/D（并行度高）→ E（承前启后）→ F（可选）。每阶段结束 commit。
> 本轮**不含** §3.9 的两项未来能力；只保证 E 阶段划好它们的缝。
> **no-compat 附加范围**：legacy 数据链删除（对照表 §F）与 protocol `view→viewState` 改名（对照表 §A）并入阶段 E；host 侧 legacy（`onRawLine`/`onSample`/`PointBatcher`/`toPlotSample`）删除见对照表「待确认决策 3」。改动 protocol 后阶段 E 必跑 `pnpm schema:generate`。

### 阶段 A（P0）宿主端去重

- **范围**：`src/panel/`
- **改动**：新建 `src/panel/webviewHtml.ts`，导出 `buildWebviewHtml({ webview, extensionUri, entry, rootId, bodyDataset })` 与共享 `getNonce()` / `escapeHtmlAttribute()`；共享 `formatError()` 移到一个小 util。两个 host 文件改为调用。
- **验收**：两处 `getNonce`/`getHtml`/`formatError` 不再重复；CSP 内容逐字不变；两个 Webview 仍能加载各自资源。
- **测试**：`pnpm test`（panel/provider 现有测试）+ `pnpm package`（smoke）。
- **commit**：`refactor: 抽取共享 webview HTML/nonce helper`

### 阶段 B（P0）Vue store 传递方式

- **范围**：`webview/src/monitor/`、`webview/src/profile-editor/`
- **改动**：定义 `MonitorStoreKey` / `ProfileEditorStoreKey` + `useMonitorStore()` / `useProfileEditorStore()`；根组件 `provide`，子组件去 prop 改 `inject`；`<script setup>` 顶层解构 computed，模板去掉全部 `.value`；事件处理不再显式传 `store`。
- **验收**：模板中不再出现 `store.*.value`；子组件不再声明 `store` prop；所有低频交互行为不变。
- **测试**：`monitorVue`、`profileEditorVue`、`monitorStore`、`profileEditorStore` 改造后仍覆盖等价行为。
- **commit**：`refactor: monitor 组件改用 inject 注入 store` / `refactor: profile editor 组件改用 inject 注入 store`

### 阶段 C（P1）拆 EditorPage

- **范围**：`webview/src/profile-editor/components/`
- **改动**：`EditorPage.vue` 拆为 `IdentitySection` / `SerialCodecSection` / `FramingSection` / `ParserSection` / `OutputsSection`，outputs 内再拆 `TerminalOutputEditor` / `TimeSeriesOutputEditor` / `SeriesRow`；每个 section 只读写对应 patch 片段。顺带修问题 3：`v-for` 直接遍历 patch 数组（或 computed Map 一次解析），去掉模板内 `.find()` 与 `throw`。
- **验收**：EditorPage 仅做编排；readonly / copy / autosave / invalid 输入 / builtin 只读路径全部不变；deep watch 仍能捕获 patch 改动触发 autosave。
- **测试**：`profileEditorVue`、`profileEditorModel`、`profileEditorStore`。
- **commit**：`refactor: 拆分 profile editor 表单为 section 组件`

### 阶段 D（P1）renderer 性能/内存修复

- **范围**：`webview/src/monitor/outputs/terminal/`、`frame-plot/`
- **改动**：terminal 改增量 append（不再每 packet 整表 `textContent`）；`TerminalFrameView.frames` Map 加上限；FramePlot 缓存主题色（主题变更再刷新），`inferBounds` 改循环求 min/max。
- **验收**：长时间输出下不卡、内存不无界；渲染结果不变；现有测试通过。
- **测试**：`monitor-outputs/*`、`framePlot2d`、`timeSeries`。
- **commit**：`perf: terminal 增量渲染并限制 frame 缓冲` / `perf: frame plot 缓存主题色与边界计算`

### 阶段 E（P2）renderer 契约统一 + OutputGridController + 划缝

- **范围**：`webview/src/monitor/outputs/`、`webview/src/monitor/store.ts`、`webview/src/monitor/components/`（webview-only 改名批次）
- **改动**：按 §3.5/3.6/3.8 执行"本轮做"那批改名与契约统一：`OutputView→OutputRenderer`、`Controller/Adapter→OutputGridController`（store 字段 `outputGrid`）、`*ViewLayout→*ViewState`、`OutputWorkspace.vue→OutputGrid.vue` / `.workspace→.output-grid`；引入 `RendererContext`+`RendererFactory` 统一构造；删除回环 stub 的 `captureViewState`；统一 `resetViewState` 语义。**同时按 §3.9-A 划缝**：确认面板几何对 renderer 不可见、`OutputGrid` 是独立一层、面板/内容手势边界清楚（本轮不写面板手势）。
- **验收**：四个 renderer 契约语义一致；packet 只路由到匹配 `outputId`；profile 切换销毁旧 renderer 并清状态；layout order/density/columnSpan/minHeight/view reset/saved zoom 行为不回退；高频路径仍不进 Vue。
- **测试**：`monitor-outputs/controller`、各 renderer 测试；跨层收尾 `pnpm check`。
- **commit**：`refactor: 统一 output renderer 契约命名与语义` / `refactor: 引入 RendererContext 统一 renderer 构造`

### 阶段 F（可选）命名对齐 + 组织调整

- **改动**：`profileEditor.ts` / `profileEditorModel.ts` / `profileEditor.css` 归入 `webview/src/profile-editor/`；抽共享 `base.css`（问题 5）；（可选，ripple 大）protocol 层 `.view→.viewState`。
- **验收**：Vite 多入口产物名不变；`pnpm package` 通过。
- **commit**：`chore: 整理 profile editor 文件组织` 等，按独立小步提交。

---

## 5. 风险与回滚

| 风险                                            | 缓解                                                            |
| ----------------------------------------------- | --------------------------------------------------------------- |
| 阶段 B/E 大面积改名触碰所有组件/测试            | 分小 commit；每步 `pnpm test`；保持行为测试覆盖不降             |
| 去 prop 后遗漏某处 `.value` 造成静默 truthy bug | 改造后全量 grep `.value`；严格 typecheck；连接态/禁用态手测一轮 |
| terminal 增量渲染改错导致丢行/顺序错            | 保留 maxLines 上限测试；对照重构前后同一输入的可见输出          |
| 为 §3.9 留缝时过度设计（提前造引擎/注册表）     | 严守非目标：本轮只划边界、不写实现；§3.9 只名不做               |
| protocol `.view→.viewState`（阶段 F）ripple     | 默认不做；若做则连同 `schema:generate` 一起改并 `pnpm check`    |
| CSP / 打包产物路径被动到                        | 阶段 A/F 后必跑 `pnpm package` smoke                            |

回滚粒度＝单个 commit。因每阶段独立提交且各自验收，任一阶段异常可单独 revert 而不影响其它阶段。
