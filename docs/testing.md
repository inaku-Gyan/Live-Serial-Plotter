# 测试与调试方式

本文档说明 Live Serial Plotter 的四类测试方式：单元 mock 测试、VS Code 扩展集成测试、内置模拟串口调试、真实虚拟串口 E2E 调试。

## 1. 单元 mock 测试

用于验证解析器、串口服务、缓冲区、Webview panel 消息路由等核心逻辑，不依赖真实串口设备。

```sh
pnpm test
```

只运行某个测试文件：

```sh
pnpm test -- tests/unit/SerialService.test.ts
```

串口相关单元测试优先使用两种方式：

- `SerialPortMock`：适合验证 `serialport` stream 接口和收发数据。
- 自定义 `SerialPortFactory`：适合验证失败重试、断开清理、隔离多个服务实例等业务逻辑。

## 2. VS Code 扩展集成测试

用于验证扩展能在 VS Code Extension Host 中激活，并且命令已注册。

```sh
pnpm test:extension
```

这类测试运行在 VS Code 测试宿主中，适合覆盖激活、命令注册、VS Code API 交互。没有真实串口设备时，不要让测试依赖物理硬件。

## 3. 内置模拟串口调试

内置模拟串口只在 VS Code `Development` 或 `Test` 模式启用；安装 VSIX 或 Marketplace release 版时不会显示。

操作步骤：

1. 在 VS Code 中运行 `Run Extension`。
2. 在 Extension Development Host 中执行命令 `Live Serial Plotter: New Page`。
3. 点击 `Refresh`，选择 `sim://telemetry-a` 或 `sim://telemetry-b`。
4. 使用 `auto` 或 `keyValue` parser，点击 `Connect`。

默认模拟串口配置位于：

```txt
scripts/dev-serial/ports.config.json
```

默认数据生成器位于：

```txt
scripts/dev-serial/generators/sample-telemetry.mjs
```

可以在 `ports.config.json` 中添加多个端口，每个端口指定自己的 `path`、`label`、`baudRate`、`generator` 和 `options`。例如：

```json
{
  "path": "sim://motor-a",
  "label": "Motor A",
  "baudRate": 115200,
  "generator": "./generators/sample-telemetry.mjs",
  "options": {
    "intervalMs": 50,
    "phase": 0.5
  }
}
```

生成器模块接口：

```js
export async function* generate(context) {
  yield "temp=24.00 humidity=50.00 rpm=1200\n";
}

export function onWrite(data, context) {
  context.log(`received: ${data.toString().trim()}`);
}
```

`context` 包含：

- `portId`
- `label`
- `baudRate`
- `options`
- `signal`
- `sleep(ms)`
- `log(message)`

生成器产出的 `string` 或 `Buffer` 会作为串口输入发送给扩展。脚本作者需要自己包含换行符。

## 4. 真实虚拟串口 E2E 调试

真实虚拟串口 E2E 用系统工具创建 OS 级串口对。生成器写入一端，扩展连接另一端，因此可以验证 `serialport` native binding、端口枚举、连接和实时绘图链路。

启动：

```sh
pnpm dev:serial:e2e
```

然后在 Extension Development Host 中刷新端口列表，选择脚本输出的 E2E 端口并连接。

### Linux / macOS

脚本会自动检测 `socat` 并为每个配置端口创建一对 PTY。

如果提示找不到 `socat`：

```sh
# Ubuntu / Debian
sudo apt install socat

# Fedora
sudo dnf install socat

# macOS
brew install socat
```

### Windows

Windows 使用 com0com。默认不会修改系统 COM 设备，只复用显式指定的端口对。需要创建端口对时，传 `--create`：

```sh
pnpm dev:serial:e2e -- --create --windows-pairs COM30:COM31,COM32:COM33
```

其中每组 `A:B` 的含义是：

- 生成器写入 `A`
- VS Code 扩展连接 `B`

如果不想让脚本创建端口，可以先用 com0com GUI 或 `setupc.exe` 创建端口对，然后运行：

```sh
pnpm dev:serial:e2e -- --windows-pairs COM30:COM31,COM32:COM33
```

如果提示找不到 `setupc.exe`，请确认 com0com 已安装，并将 `setupc.exe` 所在目录加入 `PATH`。

## 5. 提交前检查

提交前至少运行：

```sh
pnpm check
pnpm package
```

如果改动涉及 E2E 脚本或打包链路，建议额外运行：

```sh
pnpm build
pnpm dev:serial:e2e
```

`pnpm dev:serial:e2e` 是手动验收命令，不要求在 CI 中创建真实系统虚拟串口。
