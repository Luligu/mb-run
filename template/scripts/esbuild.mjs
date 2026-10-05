/**
 * esbuild.mjs
 * Version: 2.0.0
 *
 * Bundles JavaScript files using esbuild.
 *
 * Usage:
 *   node scripts/esbuild.mjs <distDir...> [options]
 *
 * Options:
 *   --obfuscate                 Obfuscate the bundled JavaScript
 *   --bundle-deps               Bundle dependencies instead of treating them as external
 *   --declaration               Bundle type declarations with rollup
 *   --external <list>           Comma-separated external dependencies (defaults to actual list)
 *   --entry-points <list>       Comma-separated entry point filenames (defaults to module.js,main.js,cli.js)
 *   --dry-run, -n               List what would be bundled and removed without writing anything
 *   --version, -v               Show the script version
 *   --help, -h                  Show this help message
 *
 * The script runs only when executed directly. Importing it exposes `main` without side effects.
 */

/* oxlint-disable no-console */

import { readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const scriptVersion = '2.0.0';
const scriptName = path.basename(import.meta.filename);

// Some dependencies are optional / only used on specific code paths.
// When we build standalone bundles (e.g. for .deb packaging or the Electron tray main process),
// we still want the build to succeed even if these optional deps are not installed.
//
// "electron" must stay external when bundling the tray main process.
const defaultExternal = ['matterbridge', 'matterbridge/*', 'node-ansi-logger', 'moment', 'electron'];

const defaultEntryPoints = ['module.js', 'main.js', 'cli.js'];

/**
 * Builds the help text.
 *
 * @returns {string} The usage message.
 */
const usage = () =>
  [
    `Usage: node scripts/${scriptName} <distDir...> [options]`,
    '',
    'Bundles JavaScript files using esbuild.',
    '',
    'Options:',
    '  --obfuscate                 Obfuscate the bundled JavaScript',
    '  --bundle-deps               Bundle dependencies instead of treating them as external',
    '  --declaration               Bundle type declarations with rollup',
    '  --external <list>           Comma-separated external dependencies (defaults to actual list)',
    '  --entry-points <list>       Comma-separated entry point filenames (defaults to module.js,main.js,cli.js)',
    '  --dry-run, -n               List what would be bundled and removed without writing anything',
    '  --version, -v               Show the script version',
    '  --help, -h                  Show this help message',
  ].join('\n');

/**
 * Derives Rollup external matchers from the unified external list.
 *
 * esbuild accepts glob wildcard strings like 'matterbridge/*', whereas Rollup requires
 * exact strings or RegExps to match packages and their subpaths.
 *
 * @param {string[]} patterns - External package patterns used by esbuild.
 * @returns {RegExp[]} Matchers suitable for Rollup.
 */
const getRollupExternal = (patterns) => {
  const basePackages = new Set(patterns.map((pattern) => pattern.replace(/\/\*$/, '')));
  return Array.from(basePackages, (pkg) => new RegExp(`^${pkg}(/.*)?$`));
};

/**
 * Recursively lists all files under a directory.
 *
 * @param {string} rootDir - Directory to walk.
 * @returns {Promise<string[]>} Absolute paths of all files below rootDir.
 */
const listFilesRecursive = async (rootDir) => {
  /** @type {string[]} */
  const files = [];

  /** @param {string} currentDir - Directory being walked. */
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

/**
 * Reports whether a file in the dist directory should be removed.
 *
 * @param {string} filePath - Absolute path to the file.
 * @param {Set<string>} keepJsAbs - Set of absolute JS paths to keep.
 * @param {Set<string>} keepDtsAbs - Set of absolute DTS paths to keep.
 * @returns {boolean} True if the file should be removed.
 */
const shouldRemoveFile = (filePath, keepJsAbs, keepDtsAbs) => {
  if (filePath.endsWith('.d.ts.map') || filePath.endsWith('.js.map')) return true;
  if (filePath.endsWith('.d.ts')) return !keepDtsAbs.has(filePath);
  if (filePath.endsWith('.js')) return !keepJsAbs.has(filePath);
  return false;
};

/**
 * Options for bundling a dist directory.
 *
 * @typedef {object} BundleOptions
 * @property {boolean} shouldObfuscate - Whether to obfuscate the bundled JavaScript.
 * @property {boolean} shouldBundleDeps - Whether to bundle dependencies into the output.
 * @property {boolean} shouldBundleDeclaration - Whether to bundle type declarations with rollup.
 * @property {boolean} dryRun - Whether to run without writing or removing files.
 * @property {string[]} external - List of external packages/patterns.
 * @property {string[]} entryPoints - List of entry point file names to search for.
 */

/**
 * Bundles a single dist directory in place.
 *
 * @param {string} distDir - Dist directory to bundle in place.
 * @param {BundleOptions} options - Bundling options.
 * @returns {Promise<void>}
 */
const bundleDir = async (distDir, options) => {
  const { shouldObfuscate, shouldBundleDeps, shouldBundleDeclaration, dryRun, external, entryPoints } = options;

  console.log(`[esbuild] dir: ${distDir}`);
  const dirStat = await stat(distDir).catch(() => null);
  if (!dirStat?.isDirectory()) {
    throw new Error(`Not a directory: ${distDir}`);
  }

  const dirEntries = await readdir(distDir);

  let keepJs = entryPoints.filter((entry) => dirEntries.includes(entry));
  if (entryPoints === defaultEntryPoints && dirEntries.includes('module.js')) {
    keepJs = keepJs.filter((entry) => entry !== 'main.js');
  }

  if (keepJs.length === 0) {
    throw new Error(`Missing entry point (${entryPoints.join(', ')}) in ${distDir}`);
  }

  const keepJsAbs = new Set(keepJs.map((fileName) => path.join(distDir, fileName)));
  // Without --declaration no type declaration is kept: every .d.ts is removed.
  const keepDtsAbs = new Set(shouldBundleDeclaration ? keepJs.map((fileName) => path.join(distDir, fileName.replace(/\.js$/, '.d.ts'))) : []);

  /** @type {string[]} */
  const removedEntries = [];

  if (dryRun) {
    for (const fileName of keepJs) {
      console.log(`[dry-run] Would bundle ${path.join(distDir, fileName)}`);
      if (shouldObfuscate) {
        console.log(`[dry-run] Would obfuscate ${path.join(distDir, fileName)}`);
      }
      if (shouldBundleDeclaration) {
        const dtsFileName = fileName.replace(/\.js$/, '.d.ts');
        console.log(`[dry-run] Would bundle declarations for ${path.join(distDir, dtsFileName)}`);
      }
    }

    const allFiles = await listFilesRecursive(distDir);
    for (const filePath of allFiles) {
      if (shouldRemoveFile(filePath, keepJsAbs, keepDtsAbs)) {
        const relPath = path.relative(distDir, filePath);
        console.log(`[dry-run] Would remove ${relPath}`);
        removedEntries.push(relPath);
      }
    }

    console.log(`[dry-run] done: ${distDir} (kept: ${keepJs.join(', ')}; would remove: ${removedEntries.length})`);
    return;
  }

  /** @type {{ build: (options: any) => Promise<{ outputFiles?: Array<{ text: string }> }> }} */
  // @ts-ignore -- esbuild is an external build tool
  const esbuild = await import('esbuild');

  /** @type {Map<string, string>} */
  const builtOutputs = new Map();

  for (const fileName of keepJs) {
    console.log(`[esbuild]   bundle: ${fileName}`);
    const entryPath = path.join(distDir, fileName);
    const buildResult = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: ['esnext'],
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
      // @ts-ignore -- javascript-obfuscator is an external build tool
      const obfuscatorModule = await import('javascript-obfuscator');
      const JavaScriptObfuscator = obfuscatorModule.default ?? obfuscatorModule;

      console.log(`[esbuild]   obfuscate: ${fileName}`);
      outputCode = JavaScriptObfuscator.obfuscate(outputCode, {
        compact: true,
        renameGlobals: false,
        identifierNamesGenerator: 'hexadecimal',
        stringArray: true,
        stringArrayThreshold: 0.8,
        splitStrings: true,
        splitStringsChunkLength: 10,
        sourceMap: false,
      }).getObfuscatedCode();
    }

    builtOutputs.set(fileName, outputCode);
  }

  // Bundle type declarations into a single self-contained .d.ts file.
  if (shouldBundleDeclaration) {
    const { rollup } = await import('rollup');
    const { dts } = await import('rollup-plugin-dts');
    const rollupExternal = shouldBundleDeps ? [...getRollupExternal(external), /^node:/] : (/** @type {string} */ id) => !id.startsWith('.') && !path.isAbsolute(id);
    for (const fileName of keepJs) {
      const dtsFileName = fileName.replace(/\.js$/, '.d.ts');
      const dtsDest = path.join(distDir, dtsFileName);
      console.log(`[esbuild]   dts-bundle: ${dtsFileName}`);
      const bundle = await rollup({
        input: dtsDest,
        plugins: [dts()],
        external: rollupExternal,
      });
      const { output } = await bundle.generate({ format: 'es' });
      await bundle.close();
      await writeFile(dtsDest, output[0].code, 'utf8');
    }
  }

  // Remove generated JS artifacts, keep only the bundled entry-point type declaration (with --declaration).
  const allFiles = await listFilesRecursive(distDir);
  for (const filePath of allFiles) {
    if (shouldRemoveFile(filePath, keepJsAbs, keepDtsAbs)) {
      await rm(filePath, { recursive: true, force: true });
      removedEntries.push(path.relative(distDir, filePath));
    }
  }

  for (const [fileName, outputCode] of builtOutputs) {
    await writeFile(path.join(distDir, fileName), `${outputCode}\n`, 'utf8');
  }

  console.log(`[esbuild] done: ${distDir} (kept: ${keepJs.join(', ')}; removed: ${removedEntries.length})`);
};

/**
 * Bundles the JavaScript files in the specified dist directories.
 *
 * @param {string[]} [args] - Command line arguments, without the runtime and script paths.
 * @returns {Promise<number>} The exit code.
 */
export const main = async (args = process.argv.slice(2)) => {
  const knownFlags = new Set(['--obfuscate', '--bundle-deps', '--declaration', '--external', '--entry-points', '--dry-run', '-n', '--version', '-v', '--help', '-h']);

  const unknownArgs = args.filter((arg) => arg.startsWith('-') && !knownFlags.has(arg.split('=')[0]));
  if (unknownArgs.length > 0) {
    console.error(`Unknown argument${unknownArgs.length === 1 ? '' : 's'}: ${unknownArgs.join(', ')}. Run with --help for usage.`);
    return 1;
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log(scriptVersion);
    return 0;
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    return 0;
  }

  /** @type {string[]} */
  const customExternal = [];
  /** @type {string[]} */
  const customEntryPoints = [];
  /** @type {string[]} */
  const dirs = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--external') {
      const next = args[++i];
      if (!next || next.startsWith('-')) {
        console.error('Missing value for --external. Run with --help for usage.');
        return 1;
      }
      customExternal.push(
        ...next
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (arg.startsWith('--external=')) {
      const val = arg.slice('--external='.length);
      if (!val) {
        console.error('Missing value for --external. Run with --help for usage.');
        return 1;
      }
      customExternal.push(
        ...val
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (arg === '--entry-points') {
      const next = args[++i];
      if (!next || next.startsWith('-')) {
        console.error('Missing value for --entry-points. Run with --help for usage.');
        return 1;
      }
      customEntryPoints.push(
        ...next
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (arg.startsWith('--entry-points=')) {
      const val = arg.slice('--entry-points='.length);
      if (!val) {
        console.error('Missing value for --entry-points. Run with --help for usage.');
        return 1;
      }
      customEntryPoints.push(
        ...val
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (!arg.startsWith('-')) {
      dirs.push(arg);
    }
  }

  const shouldObfuscate = args.includes('--obfuscate');
  const shouldBundleDeps = args.includes('--bundle-deps');
  const shouldBundleDeclaration = args.includes('--declaration');
  const dryRun = args.includes('--dry-run') || args.includes('-n');

  const external = customExternal.length > 0 ? customExternal : defaultExternal;
  const entryPoints = customEntryPoints.length > 0 ? customEntryPoints : defaultEntryPoints;

  if (dirs.length === 0) {
    console.error('Missing dist directory. Run with --help for usage.');
    return 1;
  }

  console.log(
    `[esbuild] processing ${dirs.length} dist director${dirs.length === 1 ? 'y' : 'ies'}; obfuscate=${shouldObfuscate}; bundle-deps=${shouldBundleDeps}; declaration=${shouldBundleDeclaration}`,
  );

  try {
    for (const distDir of dirs) {
      await bundleDir(distDir, { shouldObfuscate, shouldBundleDeps, shouldBundleDeclaration, dryRun, external, entryPoints });
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
};

// `import.meta.main` needs Node.js 22.18 or 24.2; older runtimes fall back to comparing the executed script path.
if (import.meta.main ?? path.resolve(process.argv[1] ?? '') === import.meta.filename) process.exitCode = await main();
