import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    extension: 'src/extension.ts',
  },
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  deps: {
    neverBundle: ['vscode', '@serialport/bindings-cpp'],
  },
});
