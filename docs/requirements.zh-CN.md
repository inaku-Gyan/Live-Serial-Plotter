# 需求记录（Agent 用）

本文档记录用户在对话中提出并确认过的产品与工程需求，主要供后续 agent 继续工作时对齐上下文。每次用户提出新需求时，应先更新本文档，并检查新需求是否与本文档、`AGENTS.md`、现有实现或已提交计划冲突；如有冲突，应先向用户说明冲突点，再继续实现。

## 需求维护规则

- 新需求进入实现前，先补充或更新本文档中的对应条目。
- 更新时检查是否与已有需求、架构约束、profile schema、消息协议或测试策略冲突。
- 若存在冲突，必须明确告诉用户冲突内容、受影响范围和建议取舍。
- 若需求已被实现，也应保留为稳定约束，避免后续改动无意回退。

## 已记录需求

### 监视器页面按 Profile 输出待机视图

- 新打开监视器页面、尚未连接串口时，也要按当前 active profile 的 `outputs` 显示待机/骨架视图。
- 同种输出终端使用统一待机图或待机态；输出终端包括 `timeSeriesLine`、`terminalAppend`、`terminalFrame`、`framePlot2d` 等。
- 监视器视图有哪些输出仍由 profile 的 `outputs` 定义；页面排布和可保存视图样式由 profile 引用的独立 layout preset 定义。
- `ProfileConfig` 使用 `schemaVersion: 3`，必须配置 `layout.defaultPreset`，指向 builtin/user/workspace layout preset。
- `timeSeriesLine.series: {}` 保持“运行时自动发现 numeric field”语义；待机态不猜测通道。

### 监视器 Layout Preset

- layout preset 是独立 JSONC 配置文件，workspace 路径为 `.live-serial-plotter/layouts/*.jsonc`，user layout 与 user profiles 平级，builtin layout 由扩展内置。
- layout preset 使用 `schemaVersion: 1`，包含 `id`、`name`、`page` 和按 `outputId` 索引的 `outputs`。
- 每次打开新 monitor 窗口，都必须按当前 profile 的 `layout.defaultPreset` 解析初始页面布局。
- layout preset 可保存页面级设置，例如 grid 列策略、density、输出面板 order、columnSpan、minHeight、collapsed、maximized。
- layout preset 可保存输出视图默认值，例如 plot legend、auto-follow、显式保存后的 zoom 范围、terminal auto-scroll、2D frame bounds。
- 当前窗口内由用户拖拽、点击、缩放产生的视图变化先进入 window session override，不自动覆盖 profile 或 layout 文件。
- 用户显式 Save Layout 才覆盖当前 layout preset；Save As Layout 创建新 layout preset，并更新当前 profile 的 `layout.defaultPreset`。
- 每个 output 面板应支持单独 Reset View；页面应支持 Reset Layout。reset 只恢复布局/视图状态，不清空实时数据。
- 实时数据点、terminal 当前文本、canvas frame、hover/cursor、临时选区、toast 和串口连接状态永不写入 profile 或 layout。
- monitor layout 控制条（当前 layout 名称、Reset Layout、Save Layout、Save As）应紧跟连接 toolbar 显示，使用内容高度，不应占用 workspace 的可伸缩空间。
- 连接按钮在可连接状态使用 primary 样式；已连接时的 Disconnect 按钮使用中性 secondary 样式，不使用错误/危险色。

### 监视器页面 Vue 外壳与高频渲染边界

- 监视器页面使用 Vue 3 管理低频 UI 外壳：toolbar、profile/port/baud/parser 状态、send row、toast、output workspace 容器。
- 不引入 Pinia；沿用 typed composable store 风格。
- uPlot、canvas、终端输出等高频渲染保留命令式 adapter。
- uPlot 实例、图表数据数组、canvas frame 数据不得放入 Vue 深层响应式状态。
- `outputPacket`、legacy `rawLine`、legacy `seriesAppend` 直接转发给命令式 renderer，不进入 Vue reactive packet buffer。
- 不引入 React。

### Time-Series Plot 行为

- `timeSeriesLine` 应固定显示一个滚动窗口，并持续追踪最新数据点。
- 用户用鼠标拖拽放大 time-series 图表区域后，缩放视图应保持，不应被下一次数据刷新立刻回弹到默认滚动窗口。
- time-series 图表交互入口应优先实现为 uPlot plugin/hooks：包括手动 scale 变更检测、鼠标滚轮缩放、拖拽平移、触摸平移/捏合缩放和双击重置视图。
- time-series 图表交互绑定应集中在统一配置中；普通左键保持 uPlot 默认框选缩放，普通滚轮上下平移，`Shift + 滚轮` 左右平移，`Ctrl + 滚轮` 缩放；触控板双指滚动沿 `deltaX/deltaY` 平移，触控板捏合按 `Ctrl + wheel` 缩放处理。
- 普通左键框选缩放应设置最小拖拽距离死区，避免点击或极小拖拽误触发缩放。
- time-series 十字准线可保留 hover marker，但 marker 只应在鼠标接近某条可见曲线时显示；鼠标离开曲线或图表时不应把最近点残留在曲线上。
- 默认状态仍自动滚动追踪最新数据；一旦用户手动缩放，应暂停自动追踪，直到图表结构重建、清空或切换 profile。
- `window.mode: "points"` 保留并显示最新 `maxPoints` 个采样点。
- `window.mode: "duration"` 按最新样本时间显示最近 `seconds` 秒。
- 横轴应显示坐标和单位；非 sequence 时间轴当前按秒绘制，显示为 `Time (s)`。
- 多个不同 `series.unit` 共存时，按单位拆分 y scale 和 y axis。
- 相同单位共用一个 y 轴；第一个单位放左轴，后续单位放右轴。
- 未配置 `unit` 的自动发现字段使用默认 `Value` 轴。
- `series.scale` 继续在 Extension Host mapper 阶段应用；Webview 显示缩放后的 plotted value。
- 使用自定义 legend；关闭 uPlot 内置 legend，避免字段叠加。

### Profile 与协议边界

- 具体串口端口和当前波特率属于运行时连接设置，不写入 profile。
- `serialDefaults.baudRate` 只作为 profile 选择后的默认提示；用户手动改过 baud 后，不应被 profile 切换覆盖。
- 修改 Extension Host 和 Webview 协议时，先改 `src/shared/protocol.ts` 的 discriminated union，再同步两端处理。
- layout preset 架构要求修改 profile schema、layout schema 和 Extension Host/Webview 消息协议；高频 `outputPacket` 协议保持不变。

### 性能与测试

- 高频数据必须批处理，避免每个点都重建图表或触发 DOM 列表渲染。
- uPlot 只在通道结构或结构性配置变化时重建；普通追加用 `setData()`，可见性切换用 `setSeries()`，尺寸变化用 `setSize()`。
- 持续运行场景必须保留最大点数和最大日志行数限制。
- 修改 parser、串口读取、缓冲、批处理或图表数据变换时优先补充 Vitest 单元测试。
- 涉及监视器 Vue 外壳时补充 store 和 Vue 组件测试；涉及命令式 output renderer 时补充 `monitorOutputs` 测试。

## 已发现并处理的冲突

- 旧约束写着“监控页继续使用 Vanilla TypeScript”；现需求和实现已改为“监视器页面使用 Vue 3 外壳，uPlot/canvas 保持命令式高性能路径”。`AGENTS.md` 应以新架构为准。
- 旧需求写着“不新增 profile layout 字段，布局按 `outputs` 顺序和 output kind 推导”；现需求已改为“profile v3 必须引用独立 layout preset”。`outputs` 仍定义输出语义，但默认排布由 layout preset 决定。
