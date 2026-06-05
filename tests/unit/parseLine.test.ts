import { describe, expect, test } from 'vitest';
import { parseLine, toPlotSample } from '../../src/parsers/parseLine';

describe('parseLine', () => {
  test('parses CSV numeric channels', () => {
    expect(parseLine('12.5, -3, 42', 'csv')).toEqual({
      values: {
        channel1: 12.5,
        channel2: -3,
        channel3: 42,
      },
    });
  });

  test('rejects malformed CSV lines', () => {
    expect(parseLine('12.5, nope, 42', 'csv')).toEqual({ values: {} });
  });

  test('parses numeric top-level JSON Lines fields', () => {
    expect(parseLine('{"temp":23.5,"name":"sensor","humidity":45}', 'jsonl')).toEqual({
      values: {
        temp: 23.5,
        humidity: 45,
      },
    });
  });

  test('rejects malformed JSON Lines input', () => {
    expect(parseLine('{"temp":', 'jsonl')).toEqual({ values: {} });
  });

  test('parses key=value and key:value tokens', () => {
    expect(parseLine('temp=23.5 humidity:45 rpm=1.2e3', 'keyValue')).toEqual({
      values: {
        temp: 23.5,
        humidity: 45,
        rpm: 1200,
      },
    });
  });

  test('auto mode prefers JSON, then key=value, then CSV', () => {
    expect(parseLine('{"x":1,"y":2}', 'auto')).toEqual({ values: { x: 1, y: 2 } });
    expect(parseLine('x=1 y=2', 'auto')).toEqual({ values: { x: 1, y: 2 } });
    expect(parseLine('1,2', 'auto')).toEqual({ values: { channel1: 1, channel2: 2 } });
  });

  test('raw mode does not produce plot samples', () => {
    expect(toPlotSample('1,2,3', 'raw', 1000)).toBeNull();
  });

  test('malformed line keeps parser result empty instead of throwing', () => {
    expect(() => parseLine('plain text', 'auto')).not.toThrow();
    expect(parseLine('plain text', 'auto')).toEqual({ values: {} });
  });
});
