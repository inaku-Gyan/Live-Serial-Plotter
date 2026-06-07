import { describe, expect, test } from "vitest";
import {
  applyProfileEditorPatch,
  createProfileEditorPatch,
  type ProfileEditorPatch,
} from "../../webview/src/profileEditorModel";
import type { ProfileConfig } from "../../src/shared/protocol";

describe("profileEditorModel", () => {
  test("creates an editable patch from a profile", () => {
    const patch = createProfileEditorPatch(createProfile());

    expect(patch).toEqual({
      id: "base",
      name: "Base",
      serialDefaults: { baudRate: "115200" },
      codec: { sendLineEnding: "none" },
      framing: { delimiter: "auto", trim: false, maxFrameBytes: "" },
      builtinParser: { mode: "auto", optionsJson: "" },
      terminalAppendOutputs: [
        {
          originalId: "raw",
          id: "raw",
          title: "Raw",
          source: "raw",
          template: "",
          maxLines: "500",
          autoScroll: true,
        },
      ],
      timeSeriesOutputs: [
        {
          originalId: "plot",
          id: "plot",
          title: "Plot",
          time: {
            source: "hostReceived",
            field: "",
            unit: "s",
            zero: "first",
            intervalMs: "",
          },
          maxPoints: "3000",
          series: [
            {
              key: "temp",
              field: "temp",
              label: "Temp",
              unit: "C",
              color: "#111111",
              visible: false,
              scale: "",
              lineWidth: "2",
              decimals: "2",
            },
          ],
        },
      ],
    });
  });

  test("round-trips a generated patch without losing advanced fields", () => {
    const profile: ProfileConfig = {
      ...createProfile(),
      outputs: [
        ...createProfile().outputs,
        {
          id: "status",
          kind: "terminalFrame",
          title: "Status",
          template: "{state}",
        },
      ],
    };

    const patched = applyProfileEditorPatch(profile, createProfileEditorPatch(profile));

    expect(patched.outputs.at(-1)).toEqual({
      id: "status",
      kind: "terminalFrame",
      title: "Status",
      template: "{state}",
    });
    expect(patched.outputs[1]).toEqual(
      expect.objectContaining({
        kind: "timeSeriesLine",
        series: expect.objectContaining({
          temp: expect.objectContaining({
            line: { dash: "dash", width: 2 },
            format: { decimals: 2 },
          }),
        }),
      }),
    );
  });

  test("patches basic profile fields and supported outputs", () => {
    const profile = createProfile();
    const patched = applyProfileEditorPatch(profile, createPatch());

    expect(patched.id).toBe("edited");
    expect(patched.name).toBe("Edited");
    expect(patched.serialDefaults).toEqual({
      baudRate: 9600,
    });
    expect(patched.codec).toEqual({
      kind: "text",
      encoding: "utf8",
      sendLineEnding: "lf",
    });
    expect(patched.framing).toEqual({
      kind: "line",
      delimiter: "lf",
      trim: true,
      maxFrameBytes: 1024,
    });
    expect(patched.parser).toEqual({
      kind: "builtin",
      mode: "jsonl",
      options: { flatten: true },
    });
    expect(patched.outputs[0]).toEqual({
      id: "events",
      kind: "terminalAppend",
      title: "Events",
      source: "template",
      template: "{raw}",
      maxLines: 200,
      autoScroll: false,
    });
  });

  test("preserves unsupported outputs and script parser configuration", () => {
    const profile: ProfileConfig = {
      ...createProfile(),
      parser: { kind: "script", path: "parser.mjs", options: { scale: 2 } },
      outputs: [
        ...createProfile().outputs,
        {
          id: "status",
          kind: "terminalFrame",
          title: "Status",
          template: "{state}",
        },
      ],
    };
    const patched = applyProfileEditorPatch(profile, {
      ...createPatch(),
      builtinParser: undefined,
    });

    expect(patched.parser).toEqual({ kind: "script", path: "parser.mjs", options: { scale: 2 } });
    expect(patched.outputs.at(-1)).toEqual({
      id: "status",
      kind: "terminalFrame",
      title: "Status",
      template: "{state}",
    });
  });

  test("preserves unedited time-series style fields while patching visible fields", () => {
    const patched = applyProfileEditorPatch(createProfile(), createPatch());

    expect(patched.outputs[1]).toEqual({
      id: "plot",
      kind: "timeSeriesLine",
      title: "Plot",
      time: { source: "field", field: "ms", unit: "ms", zero: "first" },
      window: { mode: "points", maxPoints: 1000 },
      series: {
        temp: {
          field: "temperature",
          label: "Temperature",
          unit: "degC",
          color: "#4cc9f0",
          visible: true,
          scale: 0.1,
          line: { dash: "dash", width: 3 },
          format: { decimals: 1 },
        },
      },
    });
  });
});

function createProfile(): ProfileConfig {
  return {
    schemaVersion: 2,
    id: "base",
    name: "Base",
    serialDefaults: { baudRate: 115200 },
    codec: { kind: "text", encoding: "utf8", sendLineEnding: "none" },
    framing: { kind: "line", delimiter: "auto" },
    parser: { kind: "builtin", mode: "auto" },
    outputs: [
      {
        id: "raw",
        kind: "terminalAppend",
        title: "Raw",
        source: "raw",
        maxLines: 500,
        autoScroll: true,
      },
      {
        id: "plot",
        kind: "timeSeriesLine",
        title: "Plot",
        time: { source: "hostReceived", unit: "s", zero: "first" },
        window: { mode: "points", maxPoints: 3000 },
        series: {
          temp: {
            field: "temp",
            label: "Temp",
            unit: "C",
            color: "#111111",
            visible: false,
            line: { dash: "dash", width: 2 },
            format: { decimals: 2 },
          },
        },
      },
    ],
  };
}

function createPatch(): ProfileEditorPatch {
  return {
    id: "edited",
    name: "Edited",
    serialDefaults: {
      baudRate: "9600",
    },
    codec: {
      sendLineEnding: "lf",
    },
    framing: {
      delimiter: "lf",
      trim: true,
      maxFrameBytes: "1024",
    },
    builtinParser: {
      mode: "jsonl",
      optionsJson: '{"flatten":true}',
    },
    terminalAppendOutputs: [
      {
        originalId: "raw",
        id: "events",
        title: "Events",
        source: "template",
        template: "{raw}",
        maxLines: "200",
        autoScroll: false,
      },
    ],
    timeSeriesOutputs: [
      {
        originalId: "plot",
        id: "plot",
        title: "Plot",
        time: {
          source: "field",
          field: "ms",
          unit: "ms",
          zero: "first",
          intervalMs: "",
        },
        maxPoints: "1000",
        series: [
          {
            key: "temp",
            field: "temperature",
            label: "Temperature",
            unit: "degC",
            color: "#4cc9f0",
            visible: true,
            scale: "0.1",
            lineWidth: "3",
            decimals: "1",
          },
        ],
      },
    ],
  };
}
