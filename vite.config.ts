import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "webview",
  base: "",
  build: {
    outDir: "../dist/webview",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, "webview/index.html"),
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
