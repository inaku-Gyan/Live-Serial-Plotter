import { describe, expect, test, beforeEach } from 'vitest';
import { SerialPortMock } from 'serialport';
import {
  SerialService,
  type SerialPortFactory,
  type SerialPortLike,
} from '../../src/serial/SerialService';
import type { ConnectionSettings, SerialPortSummary } from '../../src/shared/protocol';

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

describe('SerialService', () => {
  beforeEach(() => {
    mockSerialPort.binding.reset();
    mockSerialPort.binding.createPort('/dev/ROBOT', { echo: false, record: true });
  });

  test('lists mock ports', async () => {
    const service = new SerialService({}, new MockSerialPortFactory());

    await expect(service.listPorts()).resolves.toEqual([
      expect.objectContaining({ path: '/dev/ROBOT' }),
    ]);
  });

  test('receives raw lines and parsed samples from mock serial data', async () => {
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

    await service.connect({ path: '/dev/ROBOT', baudRate: 115200, parserMode: 'auto' });
    factory.lastPort?.port?.emitData('temp=21.5\nbad line\n1,2\n');
    await waitForMicrotask();
    await service.disconnect();

    expect(rawLines).toEqual(['temp=21.5', 'bad line', '1,2']);
    expect(samples).toEqual([{ temp: 21.5 }, { channel1: 1, channel2: 2 }]);
  });

  test('writes to the connected mock serial port', async () => {
    const factory = new MockSerialPortFactory();
    const service = new SerialService({}, factory);

    await service.connect({ path: '/dev/ROBOT', baudRate: 115200, parserMode: 'raw' });
    await service.send('ping');
    await waitForMicrotask();

    expect(factory.lastPort?.port?.lastWrite?.toString()).toBe('ping');

    await service.disconnect();
  });
});

async function waitForMicrotask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
