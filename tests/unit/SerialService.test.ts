import { EventEmitter } from "node:events";
import { describe, expect, test, beforeEach } from "vitest";
import { SerialPortMock } from "serialport";
import {
  SerialService,
  type SerialPortFactory,
  type SerialPortLike,
} from "../../src/serial/SerialService";
import type { ConnectionSettings, SerialPortSummary } from "../../src/shared/protocol";

interface MockPortBinding {
  emitData(data: string | Buffer): void;
  lastWrite: Buffer | null;
}

interface MockSerialPort extends SerialPortLike {
  port?: MockPortBinding;
}

const mockSerialPort = SerialPortMock as unknown as {
  new (options: { path: string; baudRate: number; autoOpen: boolean }): MockSerialPort;
  list(): Promise<SerialPortSummary[]>;
  binding: {
    createPort(path: string, options?: { echo?: boolean; record?: boolean }): void;
    reset(): void;
  };
};

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
  private openState = false;

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
    this.openState = false;
    callback(null);
  }

  write(data: string | Buffer, callback: (error: Error | null | undefined) => void): void {
    this.writes.push(data.toString());
    callback(null);
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

  test("receives raw lines and parsed samples from mock serial data", async () => {
    const rawLines: string[] = [];
    const samples: Array<Record<string, number>> = [];
    const factory = new MockSerialPortFactory();
    const service = new SerialService(
      {
        onRawLine: (line) => rawLines.push(line),
        onSample: (sample) => samples.push(sample.values),
      },
      factory,
    );

    await service.connect({ path: "/dev/ROBOT", baudRate: 115200, parserMode: "auto" });
    factory.lastPort?.port?.emitData("temp=21.5\nbad line\n1,2\n");
    await waitForMicrotask();
    await service.disconnect();

    expect(rawLines).toEqual(["temp=21.5", "bad line", "1,2"]);
    expect(samples).toEqual([{ temp: 21.5 }, { channel1: 1, channel2: 2 }]);
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

  test("keeps separate serial service instances isolated", async () => {
    mockSerialPort.binding.createPort("/dev/SENSOR", { echo: false, record: true });

    const robotFactory = new MockSerialPortFactory();
    const sensorFactory = new MockSerialPortFactory();
    const robotLines: string[] = [];
    const sensorLines: string[] = [];
    const robotService = new SerialService(
      {
        onRawLine: (line) => robotLines.push(line),
      },
      robotFactory,
    );
    const sensorService = new SerialService(
      {
        onRawLine: (line) => sensorLines.push(line),
      },
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
});

async function waitForMicrotask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
