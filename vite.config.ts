import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  root: "webview",
  base: "",
  plugins: [vue()],
  build: {
    outDir: "../dist/webview",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "webview/index.html"),
        profile: resolve(import.meta.dirname, "webview/profile.html"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
