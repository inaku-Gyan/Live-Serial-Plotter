Status: historical audit / not current source

本文档保留 Wayfinder #14 的历史审计证据。文中旧路径、旧术语和
`historical/superseded` 判定只用于说明迁移依据，不是当前事实、Agent 规则或开放规划的
来源；当前内容以事实文档、`AGENTS.md`、`CONTEXT.md`、ADR 和 GitHub Issues
为准。

# Wayfinder #14：文档与代码审计

> 这是一份为 [Wayfinder 地图 #13](https://github.com/inaku-Gyan/Live-Serial-Plotter/issues/13) 和研究 ticket [#14](https://github.com/inaku-Gyan/Live-Serial-Plotter/issues/14) 生成的审计记录。结论以当前 `refactor/ui` 工作树、源码、测试和生成 schema 为准；后续归档矩阵 ticket 可以决定本文件是否保留。

## 判定词

- **current-fact**：当前实现或稳定约束，适合进入事实文档、`AGENTS.md` 或 `CONTEXT.md`。
- **completed**：原计划已经完成，不能继续作为开放任务。
- **superseded**：原文中的路径、术语或方案已被后续实现取代。
- **open-decision**：仍需要产品或架构选择，适合转成 GitHub Issue。
- **out-of-scope**：不属于当前地图的目标，保留为明确的范围边界。

## `docs/requirements.zh-CN.md`

### 文档维护规则（第 3–10 行）

判定：**superseded / split**。它把用户需求、Agent 工作流、架构约束和已实现行为混成一个文件。GitHub Issues 已成为开放事项的来源；稳定 Agent 规则已进入 `AGENTS.md` 与 `docs/agents/`。剩余稳定约束应按 #15 的归档矩阵进入事实文档、`CONTEXT.md` 或 ADR。

### 监视器待机视图与 Layout Preset（第 14–34 行）

判定：**current-fact**，但 `collapsed`/`maximized` 的用户交互仍是 **open-decision**。

- `ProfileConfig` 只接受 `schemaVersion: 3`，并要求 `layout.defaultPreset`：[`src/profiles/ProfileStore.ts:427`](../../src/profiles/ProfileStore.ts#L427)、[`src/profiles/ProfileStore.ts:474`](../../src/profiles/ProfileStore.ts#L474)。
- `LayoutConfig` 只接受 `schemaVersion: 1`，按 output id 保存 page、tile 和 renderer view state：[`src/profiles/LayoutStore.ts:358`](../../src/profiles/LayoutStore.ts#L358)、[`src/shared/protocol.ts:629`](../../src/shared/protocol.ts#L629)。
- 新页面和 profile 切换会解析 `activeProfile.layout.defaultPreset`：[`src/host/MonitorPageHost.ts:181`](../../src/host/MonitorPageHost.ts#L181)、[`src/host/MonitorPageHost.ts:204`](../../src/host/MonitorPageHost.ts#L204)。
- tile 的 `collapsed` 和 `maximized` 会被解析并写入 DOM data attributes，但当前没有对应完整的折叠/最大化控制行为：[`src/profiles/LayoutStore.ts:428`](../../src/profiles/LayoutStore.ts#L428)、[`webview/src/monitor/outputs/tile/layout.ts:42`](../../webview/src/monitor/outputs/tile/layout.ts#L42)。
- Save/Save As、reset、saved zoom、follow state 和 renderer 生命周期已有实现与测试覆盖；相关内容应保留为事实行为，不再作为重复的开放任务。

### Vue 外壳与高频 renderer 边界（第 36–43 行）

判定：**current-fact**。Monitor 使用 Vue 页面外壳和 `PageStore`，高频数据由命令式 output renderer 持有；Profile Editor 也使用 typed composable store。`PageStoreKey`/`usePageStore()` 与 renderer controller 位于 [`webview/src/monitor/store.ts:63`](../../webview/src/monitor/store.ts#L63) 和 [`webview/src/monitor/outputs/outputGridController.ts:12`](../../webview/src/monitor/outputs/outputGridController.ts#L12)。这属于架构事实/约束，不应继续放在“需求待办”中。

### UI 架构路线图规则（第 45–50 行）

判定：**split**。按架构层级规划、阶段开始前重新分析、测试以行为覆盖为准是稳定的工作规则；“未来 renderer 类型”与“何时引入 registry”是 **open-decision**，应进入路线图 Issues。

### Time-Series Plot（第 52–78 行）

判定：大部分为 **completed/current-fact**，不再是开放需求。uPlot wheel/pan/zoom、follow/locked follow、auto-range、单位轴、legend、数据窗口和 rebuild 状态保留已有实现及 `tests/unit/monitor-outputs/timeSeries.test.ts` 覆盖。后续若要增加 cursor readout、统计或 downsampling，应从产品 roadmap 另建 Issue，不能把这组已完成行为整体重新列为待办。

### Profile、协议、性能、测试与 TypeScript 约束（第 80–99 行）

判定：**current-fact**。Profile 与 runtime connection 的边界、`src/shared/protocol.ts` 判别联合优先、`OutputPacketBatcher`、最大点数/行数、Vue/renderer 测试策略、`strict` 与 `exactOptionalPropertyTypes` 都已有代码或测试依据。它们应拆到事实架构、`AGENTS.md` 或 ADR，而不是继续作为一份不断累积的需求清单。

### 已发现并处理的冲突（第 101–104 行）

判定：**completed**。Vanilla TypeScript → Vue 3 外壳、输出顺序推导 → 独立 layout preset 的冲突已被当前实现和文档解决；可在 ADR/历史记录中保留一次决策说明，不需要继续占据需求文件。

## `docs/roadmap.zh-CN.md`

### 产品定位与阶段语义（第 5–13、162–181 行）

判定：产品定位和“不支持 Web/不在 Webview 执行用户脚本”等是 **current-fact/out-of-scope**；阶段优先级和“暂不优先”列表是 **open-decision** 的元数据，迁移到 GitHub Issues 时保持原语义，不在本地图内重排。

### 阶段 1：MVP 稳定化（第 15–43 行）

- 连接中/断开中细分状态、端口异常分类、设备拔出恢复、补充串口参数：**open-decision**。
- 行尾发送已存在于 `LineEnding`、Profile Store 和 `SerialService`：[`src/shared/protocol.ts:131`](../../src/shared/protocol.ts#L131)、[`src/serial/SerialService.ts:289`](../../src/serial/SerialService.ts#L289)；原条目应标为 **completed**，只保留未来扩展参数的开放部分。
- 暂停/继续、独立清空图表、raw log 自动滚动开关、toast 队列和空状态细化：**open-decision**。
- raw log/plot 上限和批处理已有实现：[`webview/src/monitor/outputs/terminal/appendRenderer.ts:68`](../../webview/src/monitor/outputs/terminal/appendRenderer.ts#L68)、[`webview/src/monitor/outputs/time-series/dataBuffer.ts:105`](../../webview/src/monitor/outputs/time-series/dataBuffer.ts#L105)、[`src/pipeline/OutputPacketBatcher.ts:9`](../../src/pipeline/OutputPacketBatcher.ts#L9)；这些 checkbox 应改为 **completed/current-fact**。
- 1000 Hz UI 压测、连接失败/断开清理覆盖、native binding VSIX 内容检查和跨平台排障指南：**open-decision**；已有单元测试、CI/package 流程和虚拟串口工具不能等同于这些完整验收项。

### 阶段 2：实时绘图（第 45–72 行）

缩放/平移、follow、颜色/隐藏、单位、多轴、setData/setSeries/setSize 边界和批处理：**completed/current-fact**，证据在 `webview/src/monitor/outputs/time-series/` 与对应测试。游标读数、采样率/统计、downsampling 评估仍是 **open-decision**。

### 阶段 3：Parser、Profile 与设备配置（第 74–98 行）

CSV header/自定义列名、key-value 更多分隔符、JSONL 扁平化、auto parser 提示、profile import/export/recent profile 和模拟串口示例：**open-decision**。内置 parser、script parser loader 和安全边界已有当前事实，但不等于这些未来能力已经完成。

### 阶段 4–5：记录、导出、回放与命令发送（第 100–134 行）

判定：**open-decision**。当前 `ProfileConfig.export` 只保留未来 capture/export 的配置形状，不能视为记录、导出、回放已实现。每个用户目标应按 #17 的粒度决策后建 Issue。

### 阶段 6：UI 架构演进（第 136–149 行）

- output renderer 目录拆分：**completed**。
- Profile Editor 组件拆分已部分完成（多个 section 组件存在），仍需决定是否继续拆分 layout/高级配置：**open-decision**。
- Host HTML/CSP/nonce helper 已抽到 `src/host/webviewHtml.ts`，`formatError` 已共享：原条目应标为 **completed**。
- renderer registry、记录/导出/回放 session 边界：**open-decision**，并受未来 output 类型和 capture 需求约束。

### 阶段 7：测试、CI 与发布（第 151–160 行）

release workflow 的分平台 VSIX、`pnpm check` 和 `pnpm package` 已存在：**completed/current-fact**。VSIX 内 native binding 内容验证、Extension Development Host smoke 指南、模拟/虚拟串口场景维护和跨平台权限排障：**open-decision**。

## `docs/ui-architecture-roadmap.zh-CN.md`

### 当前有效部分

第 7–34、62–84、112–118、146–169、194–232 行描述的高层边界大多是 **current-fact** 或未来决策输入：Host/Webview 协议边界、Vue 低频状态、命令式 renderer、高频 `outputPacket`、严格 CSP、Profile Editor store/model 和测试原则均与当前代码一致。

### 已过时的基线与术语

- 第 3–5 行仍把 `OutputWorkspace`、`MonitorOutputController`、旧 `.view` 等作为路线图数据流中的基线；这些名称已被 `MonitorPage`、`OutputGrid`、`DomOutputGridController`、`.viewState` 和 `setProfileEditorScreen` 取代：**superseded**。
- 第 40–48 行的 Monitor 数据流仍写 `OutputWorkspace DOM root` / `MonitorOutputController`：**superseded**；应改为当前路径或迁移后删除正文。
- 第 97–102 行“已完成”段落仍用旧类名描述历史：内容是 **completed**，术语需要更新或只留历史索引。
- 第 104–110 行中 no-compat legacy 删除已完成；registry、共同 contract、tile/view state 扩展仍是 **open-decision**。

### 未来能力

第 171–229 行的 renderer registry、自由栅格、`OutputTile` Vue 化、`PacketRouter`、跨页面 `MonitorPageRegistry`、记录/导出/回放、暂停和命令历史都是 **open-decision**。它们应迁移到 Issues，不能在路线图中伪装成已排定施工阶段。

## `docs/ui-refactor-plan.zh-CN.md`

### 目标模型与约束（第 74–230 行）

判定：概念边界大多是 **current-fact** 或 **open-decision** 的候选 ADR；它们定义了 `MonitorPage ⊃ OutputGrid ⊃ OutputTile ⊃ OutputRenderer`、spec/data/layout 三轴、数据绕过 Vue 和未来自由栅格的边界。但其中的 `RendererContext`、`PacketRouter`、`MonitorPageRegistry` 是计划目标，不是当前实现。

### 阶段 A–E（第 233–277 行）

判定：整体 **completed**，不应再作为施工计划执行。当前源码已有 `src/host/webviewHtml.ts`、PageStore provide/inject、拆分的 Profile Editor sections、增量 terminal renderer、有限 frame buffer、`DomOutputGridController`、OutputRenderer 命名和 no-compat legacy 删除。

唯一明确未完成的是阶段 E 中承诺的统一 `RendererContext`：当前 factory 仍是 positional `createOutputRenderer(root, output, layout)`：[`webview/src/monitor/outputs/rendererFactory.ts:10`](../../webview/src/monitor/outputs/rendererFactory.ts#L10)。这应单独成为新的架构 Issue，而不是保留整份旧计划。

### 阶段 F 与风险/回滚（第 279–298 行）

判定：**open-decision / superseded**。`profileEditorModel.ts` 已迁入 `webview/src/profile-editor/`，但 `profileEditor.ts` 和 `profileEditor.css` 仍位于 `webview/src/` 根目录，且共享 `base.css` 尚未抽取：[`webview/src/profileEditor.ts`](../../webview/src/profileEditor.ts)、[`webview/src/profileEditor.css`](../../webview/src/profileEditor.css)。阶段 F 的其余 protocol `.view → .viewState` 选项已被当前协议/类型采用或不再适用。风险与回滚段落是历史施工记录，应随旧计划删除或浓缩为 Issue 的验收说明。

## `docs/ui-refactor-rename-table.zh-CN.md`

判定：A、B、D、E、F、G、H 的大部分改名、schema 更新、legacy 删除和测试同步均为 **completed**。当前源码使用 `OutputRenderer`、`DomOutputGridController`、`PageStore`、`OutputGrid.vue`、`OutputTileLayoutConfig` 和 `.viewState`；`src/shared/protocol.ts:797` 使用 `setProfileEditorScreen`，证明表中 `setProfileEditorView` 的引用已过时。

需要单独保留为 **open-decision** 或清理的残留：

- `RendererContext`/统一 factory 构造仍未实现（第 57–73 行）。
- `normalizePanelLayout` 函数名和 `panel` 局部变量仍存在，虽然输入字段和公共类型已是 `tile`：[`src/profiles/LayoutStore.ts:414`](../../src/profiles/LayoutStore.ts#L414)、[`src/profiles/LayoutStore.ts:428`](../../src/profiles/LayoutStore.ts#L428)。这是命名收尾选择，不代表旧公共协议仍存在。
- 表中 `src/panel/`、`LiveSerialPlotterPanel`、`monitorOutputs.ts`、`OutputWorkspace.vue`、`setProfileEditorView` 等路径或名称在当前树中不存在：**superseded**。

## 交叉结论

1. 当前实现已经完成原 UI no-compat 重构的大部分 A–E/F 施工；把这些章节原样迁移为开放 Issue 会重新制造已完成任务。
2. `requirements` 应拆为稳定约束与开放事项；稳定约束不应继续与产品 roadmap 共存于一个需求日志。
3. `ui-architecture-roadmap` 可压缩成当前架构事实 + 未决架构问题；`ui-refactor-plan` 与 `ui-refactor-rename-table` 的施工正文可以迁移后删除。
4. 产品 roadmap 中已实现的图表、批处理、布局和 CI 条目要标记为 completed；未实现能力按用户目标迁移到 Issues，保持原阶段/优先级，不在本地图内重排。
5. 旧 GitHub Issues #4、#6、#7、#8、#9、#11 需要在 #18 中逐一补 category/state、正文和实现证据；不能只给新建 tickets 加标签。
