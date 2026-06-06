# Profile 与 Pipeline 配置

Live Serial Plotter 的数据链路按以下顺序处理串口数据：

```txt
serial bytes -> codec -> framing -> parser -> output mappers -> output sinks -> Webview renderers
```

## Profile 位置

配置文件使用 JSONC。工作区配置放在：

```txt
.live-serial-plotter/
  profiles/*.jsonc
  parsers/*.mjs
```

用户全局 profile 会从 VS Code `globalStorageUri/profiles` 读取。内置 `default`
profile 等价于当前默认行为：UTF-8 文本 codec、行分割、`auto` parser、raw terminal 和实时折线图。

Profile id 只需要在自己的命名空间内唯一。命名空间包括：

- 每个 VS Code workspace folder。
- 用户全局 profile。
- 内置 profile。

因此 `workspace/default`、`user/default` 和 `builtin/default` 可以同时存在。下拉列表按 workspace、user、builtin
排序；多 workspace 时按 VS Code workspace folder 顺序排序，并显示具体 workspace 名称。

Profile 只描述协议、解析和输出。具体串口端口和当前波特率属于监控页面的运行时连接设置，不写入 profile。Profile 中的
`serialDefaults.baudRate` 只作为默认值提示。

## 侧边栏可视化配置

扩展在 Activity Bar 中提供 `Live Serial Plotter` 视图，侧边栏里的 `Profiles & Pipeline`
用于基础 profile 可视化配置。

首版支持编辑：

- profile `name`；`id` 只读
- serial defaults：默认波特率
- codec：UTF-8 文本编码、发送文本时追加的行尾
- framing：文本行 delimiter、trim、最大 frame 字节数
- builtin parser：mode 和 options JSON
- `terminalAppend` output
- `timeSeriesLine` output、时间轴和 series 样式

`script` parser、`terminalFrame`、`framePlot2d` 和其他未覆盖的高级配置会显示为只读。需要编辑这些字段时，用侧边栏中的
`Open JSONC` 打开原始配置文件。内置 profile 没有 JSONC 文件，需要先 Copy 到用户或某个 workspace。

侧边栏不提供 Save / Save As。用户或 workspace profile 在字段变化后会自动保存回原 JSONC 文件。内置 profile 是只读的；
点击 `Copy Profile` 可以复制到用户命名空间或指定 workspace 命名空间。自动保存不会自动应用到已打开的监控页面；在监控页刷新/重新选择
profile 后生效。

## Profile 示例

```jsonc
{
  "schemaVersion": 2,
  "id": "sample-telemetry",
  "name": "Sample Telemetry",
  "serialDefaults": {
    "baudRate": 115200,
  },
  "codec": {
    "kind": "text",
    "encoding": "utf8",
    "sendLineEnding": "none",
  },
  "framing": {
    "kind": "line",
    "delimiter": "auto",
  },
  "parser": {
    "kind": "builtin",
    "mode": "keyValue",
    "options": {
      "carryForward": true,
    },
  },
  "outputs": [
    {
      "id": "raw",
      "kind": "terminalAppend",
      "title": "Raw Monitor",
      "source": "raw",
      "maxLines": 500,
    },
    {
      "id": "plot",
      "kind": "timeSeriesLine",
      "title": "Telemetry",
      "time": {
        "source": "hostReceived",
        "unit": "s",
        "zero": "first",
      },
      "series": {
        "temp": {
          "field": "temp",
          "label": "Temperature",
          "unit": "degC",
          "color": "#4cc9f0",
          "format": { "decimals": 1 },
        },
        "rpm": {
          "field": "rpm",
          "label": "RPM",
          "color": "#f72585",
        },
      },
      "window": {
        "mode": "points",
        "maxPoints": 3000,
      },
    },
  ],
}
```

`timeSeriesLine.series` 为空对象时，Webview 会自动绘制 parser 输出中的所有 numeric field。

## Builtin Parser

支持的 builtin parser mode：

- `raw`：不提取字段。
- `csv`：默认输出 `channel1`、`channel2` 等，也支持 `options.header: "firstLine"`。
- `jsonl`：解析 JSON Lines；`options.flatten: true` 会输出点路径字段，例如 `imu.ax`。
- `keyValue`：解析 `temp=24.1 rpm:1200` 这类文本。
- `auto`：按 JSON Lines、key-value、CSV 顺序尝试。

`options.carryForward: true` 会把上一帧字段补到当前帧，适合稀疏 telemetry。

## Script Parser

Script parser 只支持工作区 `.live-serial-plotter/parsers/*.mjs` 内的相对路径：

```jsonc
{
  "parser": {
    "kind": "script",
    "path": "custom-parser.mjs",
    "options": {
      "scale": 0.001,
    },
  },
}
```

脚本必须导出 `createParser(options)`：

```js
export function createParser(options) {
  return {
    parseFrame(frame) {
      return {
        fields: {
          value: Number(frame.raw) * options.scale,
        },
      };
    },
    reset() {},
    dispose() {},
  };
}
```

安全规则：

- 只在 trusted workspace 中执行。
- 首次运行和文件 hash 变化时需要用户确认。
- 不支持绝对路径、远程 URL 或 `.mjs` 以外的脚本。
- Script parser 等价于执行本地代码，不是沙箱。

## Output 样式

样式放在 output 配置中，不放进高频数据包。时间序列 output 的颜色、单位、label、线宽和数值格式配置在 `series` 下。packet 只传 `time` 和 `values`，以保持 uPlot 热路径高效。

## 二进制协议方向

当前版本只实现 `codec.kind: "text"` 和 `encoding: "utf8"`。纯二进制协议后续会通过 `codec.kind: "binary"`、
`fixedLength` / `byteDelimiter` / `rawChunk` framing、hex/base64 terminal 显示，以及 Hex/Base64 发送模式扩展。
