import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'dist/extension-tests/**/*.cjs',
  launchArgs: ['--disable-extensions'],
  useInstallation:
    process.env.VSCODE_TEST_PATH === undefined
      ? undefined
      : {
          fromPath: process.env.VSCODE_TEST_PATH,
        },
});
