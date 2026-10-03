import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SerialPortMock } from "serialport";
import {
  NodeSerialPortFactory,
  SerialService,
  type SerialConnectionError,
  type SerialPortFactory,
  type SerialPortLike,
} from "../../src/serial/SerialService";
import type { AsyncScriptParserLoader } from "../../src/pipeline/PipelineRunner";
import { defaultProfile } from "../../src/profiles/defaultProfile";
import type {
  ConnectionSettings,
  ConnectionState,
  OutputPacket,
  SerialPortSummary,
} from "../../src/shared/protocol";

interface MockPortBinding {
  emitData(data: string | Buffer): void;
  lastWrite: Buffer | null;
}

interface MockSerialPort extends SerialPortLike {
  port?: MockPortBinding;
}

interface MockSerialPortConstructor {
  new (options: { path: string; baudRate: number; autoOpen: boolean }): MockSerialPort;
  list(): Promise<SerialPortSummary[]>;
  binding: {
    createPort(path: string, options?: { echo?: boolean; record?: boolean }): void;
    reset(): void;
  };
}

const mockSerialPort = getMockSerialPortConstructor(SerialPortMock);

class MockSerialPortFactory implements SerialPortFactory {
  lastPort: MockSerialPort | undefined;

  async list(): Promise<SerialPortSummary[]> {
    return mockSerialPort.list();
  }

  create(settings: ConnectionSettings): SerialPortLike {
    this.lastPort = new mockSerialPort({
      path: settings.path,
      baudRate: settings.baudRate,
      autoOpen: false,
    });

    return this.lastPort;
  }
}

class FakeSerialPort extends EventEmitter implements SerialPortLike {
  readonly writes: string[] = [];
  closeCalls = 0;
  private openState = false;
  private writeError: Error | undefined;

  constructor(private readonly openError?: Error) {
    super();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(callback: (error: Error | null | undefined) => void): void {
    if (this.openError !== undefined) {
      callback(this.openError);
      return;
    }

    this.openState = true;
    callback(null);
  }

  close(callback: (error: Error | null | undefined) => void): void {
    this.closeCalls += 1;
    this.openState = false;
    callback(null);
  }

  write(data: string | Buffer, callback: (error: Error | null | undefined) => void): void {
    this.writes.push(data.toString());
    callback(this.writeError);
  }

  failWritesWith(error: Error): void {
    this.writeError = error;
  }
}

class SequenceSerialPortFactory implements SerialPortFactory {
  constructor(private readonly ports: FakeSerialPort[]) {}

  async list(): Promise<SerialPortSummary[]> {
    return [];
  }

  create(): SerialPortLike {
    const port = this.ports.shift();

    if (port === undefined) {
      throw new Error("No fake serial ports remain.");
    }

    return port;
  }
}

describe("SerialService", () => {
  beforeEach(() => {
    mockSerialPort.binding.reset();
    mockSerialPort.binding.createPort("/dev/ROBOT", { echo: false, record: true });
  });

  test("lists mock ports", async () => {
    const service = new SerialService({}, new MockSerialPortFactory());

    await expect(service.listPorts()).resolves.toEqual([
      expect.objectContaining({ path: "/dev/ROBOT" }),
    ]);
  });

  test("emits output packets from mock serial data", async () => {
    const packets: OutputPacket[] = [];
    const factory = new MockSerialPortFactory();
    const service = new SerialService(
      { onOutputPacket: (packet) => packets.push(packet) },
      factory,
    );

    await service.connect({ path: "/dev/ROBOT", baudRate: 115200, parserMode: "auto" });
    factory.lastPort?.port?.emitData("temp=21.5\nbad line\n1,2\n");
    await waitForMicrotask();
    await service.disconnect();

    const lines: string[] = [];
    const sampleValues: Array<Record<string, number>> = [];

    for (const packet of packets) {
      if (packet.kind === "terminalAppend") {
        lines.push(...packet.lines.map((line) => line.text));
      }

      if (packet.kind === "timeSeriesAppend") {
        sampleValues.push(...packet.samples.map((sample) => sample.values));
      }
    }

    expect(lines).toEqual(["temp=21.5", "bad line", "1,2"]);
    expect(sampleValues).toEqual([{ temp: 21.5 }, { channel1: 1, channel2: 2 }]);
  });

  test("writes to the connected mock serial port", async () => {
    const factory = new MockSerialPortFactory();
    const service = new SerialService({}, factory);

    await service.connect({ path: "/dev/ROBOT", baudRate: 115200, parserMode: "raw" });
    await service.send("ping");
    await waitForMicrotask();

    expect(factory.lastPort?.port?.lastWrite?.toString()).toBe("ping");

    await service.disconnect();
  });

  test("emits lifecycle states and detaches listeners on disconnect", async () => {
    const port = new FakeSerialPort();
    const states: ConnectionState[] = [];
    const service = new SerialService(
      { onConnectionState: (state) => states.push(state) },
      new SequenceSerialPortFactory([port]),
    );

    await service.connect({ path: "/dev/ROBOT", baudRate: 115200, parserMode: "raw" });

    expect(states).toEqual([
      { phase: "connecting", path: "/dev/ROBOT", baudRate: 115200 },
      { phase: "connected", path: "/dev/ROBOT", baudRate: 115200 },
    ]);
    expect(port.listenerCount("data")).toBe(1);
    expect(port.listenerCount("error")).toBe(1);
    expect(port.listenerCount("close")).toBe(1);

    await service.disconnect();

    expect(port.closeCalls).toBe(1);
    expect(states).toEqual([
      { phase: "connecting", path: "/dev/ROBOT", baudRate: 115200 },
      { phase: "connected", path: "/dev/ROBOT", baudRate: 115200 },
      { phase: "disconnecting", path: "/dev/ROBOT", baudRate: 115200 },
      { phase: "disconnected" },
    ]);
    expect(port.listenerCount("data")).toBe(0);
    expect(port.listenerCount("error")).toBe(0);
    expect(port.listenerCount("close")).toBe(0);
  });

  test.each([
    {
      code: "ENOENT",
      message: "no such file or directory",
      kind: "port-not-found",
      recovery: "refresh-ports",
    },
    {
      code: "EACCES",
      message: "permission denied",
      kind: "permission-denied",
      recovery: "check-permissions",
    },
    {
      code: "EBUSY",
      message: "resource busy",
      kind: "port-busy",
      recovery: "retry",
    },
    {
      code: "ERR_DLOPEN_FAILED",
      message: "native binding failed to load",
      kind: "native-binding",
      recovery: "retry",
    },
    {
      code: undefined,
      message: "No native build was found for node=22.0.0 platform=linux arch=x64",
      kind: "native-binding",
      recovery: "retry",
    },
  ])("classifies $code connection failures", async ({ code, message, kind, recovery }) => {
    const error = Object.assign(new Error(message), { code });
    const service = new SerialService(
      {},
      new SequenceSerialPortFactory([new FakeSerialPort(error)]),
    );

    await expect(
      service.connect({ path: "/dev/TEST", baudRate: 115200, parserMode: "raw" }),
    ).rejects.toMatchObject({
      kind,
      path: "/dev/TEST",
      recovery,
    });
  });

  test("classifies native binding failures while loading the real serial factory", async () => {
    const factory = new NodeSerialPortFactory(async () => {
      throw new Error("No native build was found for node=22.0.0 platform=linux arch=x64");
    });
    const service = new SerialService({}, factory);

    await expect(service.listPorts()).rejects.toMatchObject({
      kind: "native-binding",
      recovery: "retry",
    });
  });

  test("serializes repeated connect operations into one active session", async () => {
    const firstPort = new FakeSerialPort();
    const secondPort = new FakeSerialPort();
    const states: ConnectionState[] = [];
    const service = new SerialService(
      { onConnectionState: (state) => states.push(state) },
      new SequenceSerialPortFactory([firstPort, secondPort]),
    );

    await Promise.all([
      service.connect({ path: "/dev/FIRST", baudRate: 115200, parserMode: "raw" }),
      service.connect({ path: "/dev/SECOND", baudRate: 9600, parserMode: "raw" }),
    ]);

    expect(states).toEqual([
      { phase: "connecting", path: "/dev/FIRST", baudRate: 115200 },
      { phase: "connected", path: "/dev/FIRST", baudRate: 115200 },
      { phase: "disconnecting", path: "/dev/FIRST", baudRate: 115200 },
      { phase: "disconnected" },
      { phase: "connecting", path: "/dev/SECOND", baudRate: 9600 },
      { phase: "connected", path: "/dev/SECOND", baudRate: 9600 },
    ]);
    expect(firstPort.listenerCount("data")).toBe(0);
    expect(secondPort.listenerCount("data")).toBe(1);

    await service.disconnect();
  });

  test("cleans up after an unexpected port close", async () => {
    const port = new FakeSerialPort();
    const states: ConnectionState[] = [];
    const packets: OutputPacket[] = [];
    const errors: SerialConnectionError[] = [];
    const service = new SerialService(
      {
        onConnectionState: (state) => states.push(state),
        onOutputPacket: (packet) => packets.push(packet),
        onError: (error) => errors.push(error),
      },
      new SequenceSerialPortFactory([port]),
    );

    await service.connect({ path: "/dev/ROBOT", baudRate: 115200, parserMode: "raw" });
    port.emit("close");

    expect(states).toEqual([
      { phase: "connecting", path: "/dev/ROBOT", baudRate: 115200 },
      { phase: "connected", path: "/dev/ROBOT", baudRate: 115200 },
      { phase: "disconnected" },
    ]);
    expect(errors).toEqual([
      expect.objectContaining({
        kind: "device-disconnected",
        path: "/dev/ROBOT",
        recovery: "refresh-ports",
      }),
    ]);
    expect(port.listenerCount("data")).toBe(0);
    expect(port.listenerCount("error")).toBe(0);
    expect(port.listenerCount("close")).toBe(0);

    port.emit("data", Buffer.from("after-close\n"));
    await waitForMicrotask();

    expect(packets).toEqual([]);
    await expect(service.send("ping")).rejects.toThrow("No serial port is connected.");
  });

  test("still reports device removal after an earlier port error", async () => {
    const port = new FakeSerialPort();
    const errors: SerialConnectionError[] = [];
    const service = new SerialService(
      { onError: (error) => errors.push(error) },
      new SequenceSerialPortFactory([port]),
    );

    await service.connect({ path: "/dev/ROBOT", baudRate: 115200, parserMode: "raw" });
    port.emit("error", new Error("read failed"));
    port.emit("close");

    expect(errors.map((error) => error.kind)).toEqual(["unknown", "device-disconnected"]);
    await service.disconnect();
  });

  test("classifies write failures after a device disappears", async () => {
    const port = new FakeSerialPort();
    const service = new SerialService({}, new SequenceSerialPortFactory([port]));

    await service.connect({ path: "/dev/ROBOT", baudRate: 115200, parserMode: "raw" });
    port.failWritesWith(Object.assign(new Error("device removed"), { code: "ENODEV" }));

    await expect(service.send("ping")).rejects.toMatchObject({
      kind: "device-disconnected",
      path: "/dev/ROBOT",
      recovery: "refresh-ports",
    });

    await service.disconnect();
  });

  test("applies text codec send line endings", async () => {
    const factory = new MockSerialPortFactory();
    const service = new SerialService({}, factory);

    service.setProfile({
      ...defaultProfile,
      codec: { kind: "text", encoding: "utf8", sendLineEnding: "crlf" },
    });

    await service.connect({ path: "/dev/ROBOT", baudRate: 115200, parserMode: "raw" });
    await service.send("AT");
    await waitForMicrotask();

    expect(factory.lastPort?.port?.lastWrite?.toString()).toBe("AT\r\n");

    await service.disconnect();
  });

  test("keeps separate serial service instances isolated", async () => {
    mockSerialPort.binding.createPort("/dev/SENSOR", { echo: false, record: true });

    const robotFactory = new MockSerialPortFactory();
    const sensorFactory = new MockSerialPortFactory();
    const robotLines: string[] = [];
    const sensorLines: string[] = [];
    const robotService = new SerialService(
      { onOutputPacket: (packet) => collectTerminalLines(packet, robotLines) },
      robotFactory,
    );
    const sensorService = new SerialService(
      { onOutputPacket: (packet) => collectTerminalLines(packet, sensorLines) },
      sensorFactory,
    );

    await robotService.connect({ path: "/dev/ROBOT", baudRate: 115200, parserMode: "raw" });
    await sensorService.connect({ path: "/dev/SENSOR", baudRate: 9600, parserMode: "raw" });

    robotFactory.lastPort?.port?.emitData("robot-line\n");
    sensorFactory.lastPort?.port?.emitData("sensor-line\n");
    await robotService.send("robot-ping");
    await sensorService.send("sensor-ping");
    await waitForMicrotask();

    expect(robotLines).toEqual(["robot-line"]);
    expect(sensorLines).toEqual(["sensor-line"]);
    expect(robotFactory.lastPort?.port?.lastWrite?.toString()).toBe("robot-ping");
    expect(sensorFactory.lastPort?.port?.lastWrite?.toString()).toBe("sensor-ping");

    await robotService.disconnect();
    await sensorService.disconnect();
  });

  test("cleans up failed open attempts so the service can retry", async () => {
    const failedPort = new FakeSerialPort(new Error("open failed"));
    const retryPort = new FakeSerialPort();
    const service = new SerialService({}, new SequenceSerialPortFactory([failedPort, retryPort]));

    await expect(
      service.connect({ path: "/dev/FAIL", baudRate: 115200, parserMode: "raw" }),
    ).rejects.toThrow("open failed");

    expect(failedPort.listenerCount("data")).toBe(0);
    expect(failedPort.listenerCount("error")).toBe(0);
    expect(failedPort.listenerCount("close")).toBe(0);

    await service.connect({ path: "/dev/RETRY", baudRate: 115200, parserMode: "raw" });
    await service.send("retry-ping");

    expect(retryPort.writes).toEqual(["retry-ping"]);

    await service.disconnect();
  });

  test("disposes the pipeline when opening a port fails", async () => {
    const parser = {
      parseFrame: () => [],
      reset: vi.fn<() => void>(),
      dispose: vi.fn<() => void>(),
    };
    const scriptParserLoader: AsyncScriptParserLoader = {
      load: async () => parser,
    };
    const service = new SerialService(
      {},
      new SequenceSerialPortFactory([new FakeSerialPort(new Error("open failed"))]),
      { scriptParserLoader },
    );
    service.setProfile({
      ...defaultProfile,
      parser: { kind: "script", path: "parser.mjs" },
    });

    await expect(service.connect({ path: "/dev/FAIL", baudRate: 115200 })).rejects.toThrow(
      "open failed",
    );

    expect(parser.dispose).toHaveBeenCalledOnce();
  });
});

async function waitForMicrotask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function collectTerminalLines(packet: OutputPacket, target: string[]): void {
  if (packet.kind === "terminalAppend") {
    target.push(...packet.lines.map((line) => line.text));
  }
}

function getMockSerialPortConstructor(value: unknown): MockSerialPortConstructor {
  if (isMockSerialPortConstructor(value)) {
    return value;
  }

  throw new Error("SerialPortMock does not match the expected test shape.");
}

function isMockSerialPortConstructor(value: unknown): value is MockSerialPortConstructor {
  return (
    typeof value === "function" &&
    "list" in value &&
    typeof value.list === "function" &&
    "binding" in value &&
    isMockBinding(value.binding)
  );
}

function isMockBinding(value: unknown): value is MockSerialPortConstructor["binding"] {
  return (
    typeof value === "object" &&
    value !== null &&
    "createPort" in value &&
    typeof value.createPort === "function" &&
    "reset" in value &&
    typeof value.reset === "function"
  );
}
