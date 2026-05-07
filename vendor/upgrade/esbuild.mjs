import { createRequire } from 'node:module';
import path from 'node:path';
import { readdir, rm, stat, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

/** @type {{ build: (options: any) => Promise<{ outputFiles?: Array<{ text: string }> }> }} */
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const esbuild = require('esbuild');

const argv = process.argv.slice(2);
const shouldObfuscate = argv.includes('--obfuscate');
const shouldBundleDeps = argv.includes('--bundle-deps');
const dirs = argv.filter((arg) => !arg.startsWith('--'));

// Some dependencies are optional / only used on specific code paths.
// When we build standalone bundles (e.g. for .deb packaging or the Electron tray main process),
// we still want the build to succeed even if these optional deps are not installed.
//
// "electron" must stay external when bundling the tray main process.
const external = ['matterbridge', 'matterbridge/*', 'node-ansi-logger', 'archiver', 'moment', 'electron'];

console.log(
  `[esbuild] processing ${dirs.length} dist director${dirs.length === 1 ? 'y' : 'ies'}; obfuscate=${shouldObfuscate}; bundle-deps=${shouldBundleDeps}`
);

if (dirs.length === 0) {
  throw new Error(
    'Usage: node scripts/esbuild.mjs <distDir...> [--obfuscate] [--bundle-deps] (expects module.js in each distDir)'
  );
}

/**
 * Recursively lists all files under a directory.
 * @param {string} rootDir
 * @returns {Promise<string[]>}
 */
const listFilesRecursive = async (rootDir) => {
  /** @type {string[]} */
  const files = [];

  /** @param {string} currentDir */
  const walk = async (currentDir) => {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  };

  await walk(rootDir);
  return files;
};

/** @param {string} distDir */
const bundleDir = async (distDir) => {
  console.log(`[esbuild] dir: ${distDir}`);
  const dirStat = await stat(distDir).catch(() => null);
  if (!dirStat || !dirStat.isDirectory()) {
    throw new Error(`Not a directory: ${distDir}`);
  }

  const dirEntries = await readdir(distDir);

  const hasModule = dirEntries.includes('module.js');
  const hasMain = dirEntries.includes('main.js');

  if (!hasModule && !hasMain) {
    throw new Error(`Missing module.js (package) or main.js (app) in ${distDir}`);
  }

  /** @type {string[]} */
  const keepJs = [hasModule ? 'module.js' : 'main.js'];
  if (dirEntries.includes('cli.js')) keepJs.push('cli.js');

  const keepJsAbs = new Set(keepJs.map((fileName) => path.join(distDir, fileName)));

  /** @type {Map<string, string>} */
  const builtOutputs = new Map();

  /** @type {string[]} */
  const removedEntries = [];

  for (const fileName of keepJs) {
    console.log(`[esbuild]   bundle: ${fileName}`);
    const entryPath = path.join(distDir, fileName);
    const buildResult = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: ['es2020'],
      packages: shouldBundleDeps ? 'bundle' : 'external',
      external,
      treeShaking: true,
      minify: true,
      legalComments: 'none',
      sourcemap: false,
      write: false,
      outfile: entryPath,
    });

    const bundledCode = buildResult.outputFiles?.[0]?.text;
    if (bundledCode === undefined) {
      throw new Error(`esbuild produced no output for ${entryPath}`);
    }

    let outputCode = bundledCode;

    if (shouldObfuscate) {
      /** @type {{ obfuscate: (code: string, options: any) => { getObfuscatedCode: () => string } }} */
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const JavaScriptObfuscator = require('javascript-obfuscator');

      outputCode = JavaScriptObfuscator
        .obfuscate(outputCode, {
          compact: true,
          renameGlobals: false,
          identifierNamesGenerator: 'hexadecimal',
          stringArray: true,
          stringArrayThreshold: 0.8,
          splitStrings: true,
          splitStringsChunkLength: 10,
          sourceMap: false,
        })
        .getObfuscatedCode();
    }

    builtOutputs.set(fileName, outputCode);
  }

  // Remove generated JS artifacts, keep type declarations (.d.ts) intact.
  const allFiles = await listFilesRecursive(distDir);
  for (const filePath of allFiles) {
    if (filePath.endsWith('.d.ts.map')) {
      await rm(filePath, { recursive: true, force: true });
      removedEntries.push(path.relative(distDir, filePath));
      continue;
    }

    if (filePath.endsWith('.js.map')) {
      await rm(filePath, { recursive: true, force: true });
      removedEntries.push(path.relative(distDir, filePath));
      continue;
    }

    if (filePath.endsWith('.js') && !keepJsAbs.has(filePath)) {
      await rm(filePath, { recursive: true, force: true });
      removedEntries.push(path.relative(distDir, filePath));
    }
  }

  for (const [fileName, outputCode] of builtOutputs) {
    await writeFile(path.join(distDir, fileName), `${outputCode}\n`, 'utf8');
  }

  console.log(
    `[esbuild] done: ${distDir} (kept: ${keepJs.join(', ')}; removed: ${removedEntries.length})`
  );
};

for (const distDir of dirs) {
  await bundleDir(distDir);
}
