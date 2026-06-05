import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    'extension-tests/extension': 'tests/extension/suite/extension.test.ts',
  },
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: false,
  sourcemap: true,
  dts: false,
  deps: {
    neverBundle: ['vscode'],
  },
});
