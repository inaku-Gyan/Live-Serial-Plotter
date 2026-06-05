import { describe, expect, test } from "vitest";
import {
  ScriptedSerialPort,
  type ScriptedGeneratorModule,
} from "../../src/serial/dev/ScriptedSerialPort";

const definition = {
  path: "sim://unit",
  label: "Unit Simulator",
  baudRate: 115200,
  generatorPath: "/generator.mjs",
  options: {},
};

describe("ScriptedSerialPort", () => {
  test("opens, emits generated data, and stops after close", async () => {
    let resume: (() => void) | undefined;
    const chunks: string[] = [];
    const port = new ScriptedSerialPort(definition, 115200, {
      loadGenerator: async () => ({
        async *generate(context) {
          yield "temp=21\n";
          await new Promise<void>((resolve) => {
            resume = resolve;
          });

          if (!context.signal.aborted) {
            yield "temp=22\n";
          }
        },
      }),
    });

    port.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));

    await open(port);
    await waitForMicrotask();

    expect(chunks).toEqual(["temp=21\n"]);

    await close(port);
    resume?.();
    await waitForMicrotask();

    expect(chunks).toEqual(["temp=21\n"]);
  });

  test("passes writes to optional generator onWrite handler", async () => {
    const writes: string[] = [];
    const generatorModule: ScriptedGeneratorModule = {
      async *generate(context) {
        await context.sleep(1_000);

        if (!context.signal.aborted) {
          yield "unused\n";
        }
      },
      onWrite(data, context) {
        writes.push(`${context.portId}:${data.toString()}`);
      },
    };
    const port = new ScriptedSerialPort(definition, 115200, {
      loadGenerator: async () => generatorModule,
    });

    await open(port);
    await write(port, "ping");
    await close(port);

    expect(writes).toEqual(["sim://unit:ping"]);
  });
});

function open(port: ScriptedSerialPort): Promise<void> {
  return new Promise((resolve, reject) => {
    port.open((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function close(port: ScriptedSerialPort): Promise<void> {
  return new Promise((resolve, reject) => {
    port.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function write(port: ScriptedSerialPort, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    port.write(data, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function waitForMicrotask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
