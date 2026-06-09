# UI 架构重构路线图

本文档记录 Live Serial Plotter UI 架构的长期演进要求。它不是某一次重构的执行计划，也不是固定三阶段排期。每个阶段真正开始前，都要重新分析当前实现、需求、风险和测试，再制定该阶段的详细计划。

当前已确认的方向：

- 文档定位：架构路线图。
- 阶段划分：按架构层级，而不是按固定里程碑数量。
- 长期优先级：优先为更多 output renderer 类型预留空间。

## 1. 架构基线

当前 UI 分为两个 Webview 入口：

- Monitor 页面：Vue 3 负责低频 UI 外壳，命令式 renderer 负责 terminal、uPlot 和 canvas 输出。
- Profiles & Pipeline 侧边栏：Vue 3 负责 profile 列表、表单编辑、autosave 状态和菜单交互。

稳定边界：

- Extension Host 与 Webview 消息协议集中在 `src/shared/protocol.ts`。
- 高频 `outputPacket` 不进入 Vue 深层响应式状态。
- uPlot 实例、图表数据数组、canvas frame 数据和 terminal 热路径由命令式对象管理。
- Webview 只加载本地打包资源，保持严格 CSP。
- 不引入 React。

阶段性判断：

- 当前不引入 Pinia。原因是现有状态主要局限在 monitor store 和 profile editor store 内，跨页面共享实体状态还不复杂；typed composable store 更轻，测试 mock 也更直接。
- Pinia 不是永久禁令。当 profile/layout/editor/replay/capture 等多个页面需要共享复杂实体状态，或 store 组合、订阅、缓存和跨页面同步成为主要维护成本时，应重新评估。
- 旧测试可以修改、移动或移除，但必须保留行为覆盖。重构的目标不是维护测试文件形状，而是维护用户可见行为和关键架构约束。

### UI 数据流

Monitor 页面数据流：

```txt
Extension Host
  -> ToWebviewMessage / ToExtensionMessage
  -> monitor store
  -> Vue shell components
  -> OutputWorkspace DOM root
  -> MonitorOutputController
  -> renderer views: terminal / uPlot / canvas
```

Profile Editor 数据流：

```txt
Extension Host profile/layout stores
  -> ToProfileEditorWebviewMessage / ToProfileEditorMessage
  -> profile editor store
  -> ProfileEditorPatch
  -> Vue form sections
  -> profileEditorModel
  -> ProfileConfig autosave message
```

关键方向：

- Host 是跨 Webview、文件系统、串口和 VS Code API 的边界。
- Webview store 只承接低频 UI 状态、host message 和用户命令。
- Vue component 只负责展示、表单输入和局部交互。
- 命令式 renderer 独占高频渲染状态和图表/画布/终端实例。
- profile/editor model 层负责配置对象和可编辑表单 patch 的转换。

### 状态归属规则

后续新增 UI 状态时，先按以下规则判断归属：

| 状态或职责                                                                  | 归属层                                    | 说明                                                              |
| --------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| 串口连接、端口枚举、profile/layout 文件读写、script parser trust            | Extension Host                            | 涉及 VS Code API、Node 能力、文件系统或跨 Webview 协调。          |
| Extension Host 与 Webview 的消息形状                                        | `src/shared/protocol.ts`                  | 先改 discriminated union，再同步两端处理。                        |
| profile/layout 配置语义和 schema 类型                                       | `src/shared/protocol.ts`、`src/profiles/` | 配置语义属于共享协议和 profile/layout store，不属于 Vue 组件。    |
| monitor 低频 UI 状态                                                        | monitor store                             | profile/port/baud/parser 选择、连接状态、toast、layout 控制等。   |
| profile editor 页面状态                                                     | profile editor store                      | selected profile、view、menu、status、autosave debounce。         |
| editable profile 表单 patch                                                 | `profileEditorModel.ts`                   | 负责 `ProfileConfig` 与表单字符串/checkbox/select 状态互转。      |
| uPlot 实例、plot 数据数组、series visibility、canvas frame、terminal buffer | 命令式 renderer                           | 不进入 Vue 深层响应式状态，也不通过组件树逐点更新。               |
| renderer view state capture/reset                                           | renderer view + layout config             | runtime 状态由 renderer 持有，显式保存时转成 layout view config。 |
| 纯展示格式化和局部 DOM 交互                                                 | Vue component 或 renderer 内部 helper     | 只影响本组件或本 renderer，不上升到 store。                       |

## 2. Monitor Output Renderer 层

目标是降低命令式输出区复杂度，并为新增 output renderer 类型留出清晰入口。

当前方向：

- 先做保守模块拆分，不立即引入完整插件系统。
- 保留 `MonitorOutputController` 作为 output 生命周期、packet routing、layout reset/capture 的协调者。
- 每种 renderer 独立管理自己的 DOM、数据缓冲和 view state。
- `OutputWorkspace.vue` 继续只提供 workspace 容器，不接管高频输出渲染。

已完成：

- `MonitorOutputController` 和各 renderer 已迁移到 `webview/src/monitor/outputs/`，旧 `monitorOutputs.ts` 和旧顶层 `monitor-outputs` 入口均已移除。
- `terminalAppend`、`terminalFrame`、`timeSeriesLine`、`framePlot2d` 已拆成独立 renderer view 文件，并通过局部 `factory.ts` 创建；当前没有引入 registry。
- panel header、panel layout、terminal、frame plot、time-series interaction/data/legend/scale helper 和 canvas helper 已按职责拆出，renderer 仍各自持有自己的命令式 DOM、uPlot/canvas 实例和 runtime view state。
- monitor store 和测试直接导入 `webview/src/monitor/outputs/controller.ts`；高频 `outputPacket` 路由、layout capture/reset、profile 切换清理和 time-series follow/zoom 行为已由现有测试覆盖。

后续阶段开工前必须重新设计和检查：

- 新增 output 类型是否已经足够多，是否需要 `kind -> renderer factory` registry。
- `terminalAppend`、`terminalFrame`、`timeSeriesLine`、`framePlot2d` 的共同 view contract 是否稳定。
- layout preset 中 `panel` 和 `view` 状态的 capture/reset 语义是否需要扩展。
- legacy `rawLine` / `seriesAppend` 是否仍有兼容价值，是否可统一收敛到 `outputPacket`。
- uPlot resize、follow mode、zoom、legend 和 series discovery 是否仍应完全留在 renderer 内。

建议验收方向：

- profile 切换会销毁旧 view 并清空旧输出状态。
- packet 只路由到匹配 `outputId` 的 renderer。
- layout order、density、column span、min height、view reset 和 saved zoom 行为不回退。
- 高频追加仍避免 Vue 组件树重渲染。
- 新 renderer 类型可以通过局部 factory 加入，不需要改动 monitor store 的核心状态结构。

## 3. Profile Editor 层

目标是让 profile 可视化编辑持续扩展，而不会把所有表单逻辑堆在单个 Vue 文件中。

当前方向：

- `profile-editor/store.ts` 继续负责页面状态、host message、autosave debounce、菜单状态和导航。
- `profileEditorModel.ts` 继续作为 `ProfileConfig` 与 editable patch 的唯一转换层。
- Vue section 组件只读写 patch，不直接拼完整 profile，也不直接访问 VS Code API。

后续阶段开工前必须重新设计和检查：

- Profile schema 是否新增了更多可视化编辑字段。
- Layout preset 是否需要可视化编辑，是否与 profile editor 共用状态模型。
- Unsupported output、script parser、frame plot 等高级配置应该继续只读展示，还是引入专门编辑器。
- Autosave 失败、JSONC 解析错误和 schema validation 错误是否需要更明确的 UI 状态。
- 内置 profile copy 后进入编辑器的流程是否仍符合用户预期。

建议验收方向：

- builtin profile 始终只读，copy 后才可编辑。
- 用户和 workspace profile 的有效改动仍自动保存。
- invalid baud rate、invalid parser options JSON 等错误不会写入 profile。
- 表单拆分后 deep watch 仍能捕获 patch 改动。
- 旧 Vue 测试可调整，但必须保留 profile 选择、菜单、copy、autosave、readonly 和错误路径覆盖。

## 4. Webview Host 与 Bridge 层

目标是减少 Monitor panel 和 Profiles sidebar 的重复宿主代码，并保持 VS Code Webview 边界清楚。

当前方向：

- Extension Host 仍负责创建 Webview、注入 CSP、解析本地资源 URI 和处理 VS Code API 调用。
- Webview store 只通过 typed `VsCodeApi` 接口发送和接收消息。
- 不引入全局 event bus。

后续阶段开工前必须重新设计和检查：

- `LiveSerialPlotterPanel` 与 `ProfileConfigViewProvider` 的 HTML/CSP/nonce helper 是否可以共享。
- Vite 多入口产物名称和 VSIX 打包规则是否稳定。
- `retainContextWhenHidden` 对 monitor 和 sidebar 的生命周期影响是否不同。
- Webview persisted state 是否需要统一 helper，还是保持各 store 自己管理更清晰。
- 错误提示是在 Webview 内显示、VS Code notification 显示，还是两者按来源分工。

建议验收方向：

- CSP 仍严格，不允许远程脚本或用户脚本。
- `dist/webview/assets/index.js`、`index.css`、`profile.js`、`profile.css` 的加载路径不回退。
- panel 和 sidebar 的测试 mock 仍简单，不需要真实 VS Code host。
- Host helper 抽取后不会隐藏协议处理逻辑。

## 5. Renderer 扩展平台

该层不是立即实现目标，而是 output 类型增长后的演进方向。优先为更多 renderer 留空间，但避免过早抽象。

可以考虑引入 renderer registry 的触发条件：

- output 类型明显增加，例如 histogram、scatter、table、gauge、export preview、replay timeline。
- `createOutputView()` 的分支开始影响可读性或测试维护。
- 多个 renderer 需要共享注册元数据，例如默认空状态、layout view kind、profile editor 支持状态。

registry 的约束：

- 只封装 `output.kind -> renderer factory` 和少量元数据。
- 不改变 `outputPacket` 的高频协议。
- 不把 renderer 数据搬进 Vue store。
- 不要求所有 renderer 使用同一种内部实现；uPlot、canvas、terminal 可以继续各自选择最适合的命令式路径。

开工前必须重新设计和检查：

- registry 是否真的降低复杂度，还是只是把分支换成间接层。
- 每种 renderer 的 config、packet、layout view state 是否有足够稳定的 discriminated union。
- profile editor 是否需要借用同一份 renderer metadata 来决定可编辑字段和只读展示。

## 6. 未来能力影响矩阵

下表用于后续新增能力时快速判断需要重新设计的架构层。它不是实现清单；每个能力开工前仍需重新分析。

| 未来能力                                          | 主要影响层                                                        | 开工前重点判断                                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 新 chart renderer，例如 histogram、scatter、gauge | protocol、renderer factory、layout view state、profile editor     | 是否新增 `OutputConfig` / `OutputPacket` union；是否需要 renderer registry；profile editor 是可编辑还是只读展示。 |
| 新 terminal/structured table renderer             | renderer view、layout preset、output mapper                       | 数据是否仍适合 `outputPacket`；是否有最大行数/最大记录数；是否需要排序、过滤或列配置。                            |
| output renderer metadata                          | renderer 扩展平台、profile editor                                 | metadata 是否只用于注册和展示，还是会影响协议和 schema；避免把 renderer 内部状态暴露成公共 API。                  |
| Layout 可视化编辑                                 | profile editor 或独立 layout editor、layout store、Webview bridge | 是否与 profile editor 共用 store；是否需要 preview；Save/Save As 语义是否仍只写 layout preset。                   |
| Profile 导入/导出                                 | Extension Host、profile store、profile editor                     | 文件选择、冲突命名、schema validation、错误展示应在 Host 和 editor store 间如何分工。                             |
| 记录和导出                                        | session/capture 层、Extension Host、可选 export preview renderer  | capture buffer 放在哪里；导出 raw、parsed 还是 packet；是否需要独立记录状态而不是复用连接状态。                   |
| 离线回放                                          | session/replay 层、monitor store、renderer views                  | 是否复用 `outputPacket`；回放时间轴和串口连接状态必须分离；renderer 能否无串口连接运行。                          |
| 暂停/继续渲染                                     | monitor store、renderer controller、session buffer                | 暂停时继续接收的数据是缓存、丢弃还是只暂停绘制；高频路径不能因暂停 UI 变慢。                                      |
| 常用命令和发送历史                                | monitor store、profile schema、Extension Host persistence         | 哪些命令写入 profile，哪些只是 window/session 历史；行尾规则仍由 codec/send 配置统一处理。                        |
| 多 Webview 协调                                   | Extension Host、shared protocol                                   | 不依赖 Webview 内状态共享；跨 panel/sidebar 同步通过 Host 和消息协议完成。                                        |

## 7. 数据记录、导出与回放工作流

记录、导出和回放会把 UI 从纯实时 monitor 推向“实时 + 离线复盘”双模式。该方向会影响架构，但不应提前压进当前 renderer 拆分。

后续阶段开工前必须重新设计和检查：

- 实时串口、暂停缓存、记录导出和离线回放是否共享同一种 session data model。
- 回放是否复用 `outputPacket`，还是需要带 metadata 的 replay packet。
- 暂停时继续接收的数据是缓存、丢弃，还是只停止渲染。
- 导出预览是否作为一种 output renderer，还是独立工具面板。
- capture buffer 应位于 Extension Host、Webview renderer，还是独立 session 层。

建议验收方向：

- 实时高频路径不因为记录/回放 UI 变慢。
- 记录和回放模式在 UI 上明确区分。
- 导出数据不写入 layout 或 profile。
- 回放模式尽量复用 renderer，但不要复用串口连接状态。

## 8. 测试策略

UI 重构期间，测试策略应以行为和架构约束为准，而不是以旧测试文件不变为准。

可以调整的内容：

- 测试文件路径。
- 测试 fixture 结构。
- mock output adapter 或 fake renderer 的形状。
- 针对旧实现细节的低价值断言。

必须保留或替代覆盖的内容：

- Extension Host 与 Webview 协议消息路由。
- Monitor store 对 output adapter 的转发边界。
- Renderer 生命周期、packet routing、layout capture/reset 和高频追加行为。
- Time-series follow、zoom、pan、legend、series discovery 和 rolling window 行为。
- Profile editor 的 readonly、copy、autosave、invalid input 和菜单交互。
- CSP、本地资源加载和 VSIX 打包 smoke test。

每个架构层级重构结束时，至少运行对应单元测试。跨层边界重构结束时，运行 `pnpm check`；影响打包资源或 native binding 时，额外运行 `pnpm package`。
