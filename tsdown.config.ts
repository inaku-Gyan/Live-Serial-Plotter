import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    extension: "src/extension.ts",
  },
  format: "cjs",
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  deps: {
    alwaysBundle: ["serialport"],
    onlyBundle: [
      "serialport",
      "@serialport/binding-mock",
      "@serialport/parser-byte-length",
      "@serialport/parser-cctalk",
      "@serialport/parser-delimiter",
      "@serialport/parser-inter-byte-timeout",
      "@serialport/parser-packet-length",
      "@serialport/parser-readline",
      "@serialport/parser-ready",
      "@serialport/parser-regex",
      "@serialport/parser-slip-encoder",
      "@serialport/parser-spacepacket",
      "@serialport/stream",
      "debug",
      "has-flag",
      "ms",
      "supports-color",
    ],
    neverBundle: ["vscode", "@serialport/bindings-cpp"],
  },
});
