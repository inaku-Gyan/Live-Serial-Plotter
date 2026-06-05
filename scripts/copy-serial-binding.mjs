import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const targetNodeModules = resolve('dist/node_modules');
const copiedPackages = new Set();

await rm(join(targetNodeModules, '@serialport'), { recursive: true, force: true });
await copyPackageWithRuntimeDependencies('@serialport/bindings-cpp');

async function copyPackageWithRuntimeDependencies(packageName) {
  if (copiedPackages.has(packageName)) {
    return;
  }

  copiedPackages.add(packageName);

  const { packageJson, sourceDir } = await findPackageRoot(packageName);

  for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    await copyPackageWithRuntimeDependencies(dependencyName);
  }

  const targetDir = join(targetNodeModules, ...packageName.split('/'));
  await mkdir(dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, {
    recursive: true,
    dereference: true,
    filter: (source) => !source.includes(`${packageName}/node_modules/`),
  });
}

async function findPackageRoot(packageName) {
  let currentDir = dirname(require.resolve(packageName));

  while (currentDir !== dirname(currentDir)) {
    try {
      const packageJson = JSON.parse(await readFile(join(currentDir, 'package.json'), 'utf8'));

      if (packageJson.name === packageName) {
        return {
          packageJson,
          sourceDir: currentDir,
        };
      }
    } catch {
      // Keep walking upward until the package root is found.
    }

    currentDir = dirname(currentDir);
  }

  throw new Error(`Unable to find package root for ${packageName}.`);
}
