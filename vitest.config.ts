import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL("./tests/mocks/vscode.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.mjs"],
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
