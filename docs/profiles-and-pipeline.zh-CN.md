# Profile 与 Pipeline 配置

Live Serial Plotter 的数据链路按以下顺序处理串口数据：

```txt
serial bytes -> framing -> parser -> output mappers -> output sinks -> Webview renderers
```

## Profile 位置

配置文件使用 JSONC。工作区配置放在：

```txt
.live-serial-plotter/
  profiles/*.jsonc
  parsers/*.mjs
```

用户全局 profile 会从 VS Code `globalStorageUri/profiles` 读取。内置 `default`
profile 等价于当前默认行为：UTF-8 行分割、`auto` parser、raw terminal 和实时折线图。

## Profile 示例

```jsonc
{
  "schemaVersion": 1,
  "id": "sample-telemetry",
  "name": "Sample Telemetry",
  "connection": {
    "baudRate": 115200,
    "lineEnding": "none",
  },
  "framing": {
    "kind": "line",
    "encoding": "utf8",
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
