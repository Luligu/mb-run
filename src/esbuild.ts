/**
 * @file src/esbuild.ts
 * @description This file contains esbuild bundle utilities for the mb-run command.
 * @author Luca Liguori
 * @created 2026-05-03
 * @version 1.0.0
 * @license Apache-2.0
 *
 * Copyright 2026, 2027, 2028 Luca Liguori.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { build, type BuildOptions } from 'esbuild';

import { resolveWorkspacePackageJsonPaths } from './cache.js';
import { fileExists } from './clean.js';
import { isPlugin, parsePackageJson } from './helpers.js';
import { logEsbuild, logEsbuildAction, logEsbuildOptions } from './logger.js';

/** Context shared by all esbuild operations. */
export interface EsbuildOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** True when running on Windows. */
  isWindows: boolean;
  /** When true, log but skip command execution and file-system writes. */
  dryRun: boolean;
  /** When true, print the resolved esbuild options. */
  verbose?: boolean;
  /** When true, minify the generated bundle. */
  minify?: boolean;
}

/** A user-declared runtime entry point bundled into the package dist directory. */
interface DeclaredEntryPoint {
  /** Absolute source file path. */
  in: string;
  /** Relative output path without its JavaScript extension. */
  out: string;
}

/** A user-declared compiled file tree copied into the package dist directory. */
interface DeclaredCopyEntry {
  /** Absolute source directory path. */
  from: string;
  /** Relative destination directory within dist. */
  to: string;
  /** Glob patterns matched against source-relative file paths. */
  include: RegExp[];
}

/**
 * Resolves compiled file trees declared in `automator.copyEntries`.
 *
 * Copy entries preserve generated ESM façades that must remain separate from the
 * esbuild bundle. This is needed when a façade uses `export *` from an external
 * package: ESM export names must stay static, while esbuild cannot statically expose
 * every name from an external star re-export. Each entry validates a project-local
 * source directory, a dist-relative destination, and its file-selection patterns.
 *
 * @param {Record<string, unknown>} packageJson Parsed root package.json content.
 * @param {string} rootDir Project root directory.
 * @returns {Promise<DeclaredCopyEntry[]>} Validated copy entries.
 * @throws {Error} If a copy entry is malformed or escapes the project.
 */
async function resolveDeclaredCopyEntries(packageJson: Record<string, unknown>, rootDir: string): Promise<DeclaredCopyEntry[]> {
  const automator = packageJson['automator'];
  if (typeof automator !== 'object' || automator === null || Array.isArray(automator)) return [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const copyEntries = (automator as Record<string, unknown>)['copyEntries'];
  if (!Array.isArray(copyEntries)) return [];
  const entries: DeclaredCopyEntry[] = [];
  for (const [index, copyEntry] of copyEntries.entries()) {
    if (typeof copyEntry !== 'object' || copyEntry === null || Array.isArray(copyEntry)) throw new Error(`Invalid automator.copyEntries[${index}]: expected an object`);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const entry = copyEntry as Record<string, unknown>;
    const from = entry['from'];
    const to = entry['to'];
    const include = entry['include'];
    if (typeof from !== 'string' || !from || typeof to !== 'string' || !to || !Array.isArray(include) || include.some((pattern) => typeof pattern !== 'string' || !pattern)) {
      throw new Error(`Invalid automator.copyEntries[${index}]: from, to, and include must be non-empty strings`);
    }
    const sourcePath = path.resolve(rootDir, from);
    const relativeSource = path.relative(rootDir, sourcePath);
    const destinationPath = to.replace(/\\/g, '/').replace(/^\.\//, '');
    if (
      relativeSource.startsWith('..') ||
      path.isAbsolute(relativeSource) ||
      destinationPath.split('/').includes('..') ||
      path.posix.isAbsolute(destinationPath) ||
      !(await fileExists(sourcePath))
    ) {
      throw new Error(`Invalid automator.copyEntries[${index}]: paths must stay within the project and source directory must exist`);
    }
    logEsbuildAction('copyEntries', [from, '--to', to, '--include', ...include], rootDir);
    entries.push({
      from: sourcePath,
      to: destinationPath,
      include: include.map(
        (pattern) =>
          new RegExp(
            `^${pattern
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/\*\*\//g, '(?:.*/)?')
              .replace(/\*\*/g, '.*')
              .replace(/\*/g, '[^/]*')}$`,
          ),
      ),
    });
  }
  return entries;
}

/**
 * Copies declared compiled files after esbuild has written its outputs.
 *
 * Esbuild writes first so normal bundle output is available, then matching source
 * files replace selected dist outputs. This lets a package keep static ESM façades
 * such as `export * from '@matter/main'` without bundling a stateful external graph.
 * The recursive traversal preserves each matched file's source-relative path.
 *
 * @param {DeclaredCopyEntry[]} entries Validated copy entries.
 * @param {string} rootDir Project root directory.
 * @returns {Promise<void>} Resolves when every matching file is copied.
 */
async function copyDeclaredEntries(entries: DeclaredCopyEntry[], rootDir: string): Promise<void> {
  for (const entry of entries) {
    const copyDirectory = async (directory: string, relativeDirectory: string): Promise<void> => {
      for (const file of await readdir(directory, { withFileTypes: true })) {
        const relativePath = path.posix.join(relativeDirectory, file.name);
        const sourcePath = path.join(directory, file.name);
        if (file.isDirectory()) {
          await copyDirectory(sourcePath, relativePath);
        } else if (file.isFile() && entry.include.some((pattern) => pattern.test(relativePath))) {
          const destinationPath = path.join(rootDir, 'dist', entry.to, ...relativePath.split('/'));
          await mkdir(path.dirname(destinationPath), { recursive: true });
          logEsbuildAction('copy', [sourcePath, destinationPath], rootDir);
          await copyFile(sourcePath, destinationPath);
        }
      }
    };
    await copyDirectory(entry.from, '');
  }
}

/**
 * Resolves additional runtime entry points declared in `automator.entryPoints`.
 *
 * Main, public exports, and npm bins are discovered automatically, but workers and
 * other files loaded later by path are invisible to that discovery. These declarations
 * make them explicit esbuild inputs and place their self-contained outputs at stable
 * paths under dist. Source and output validation prevents a package manifest from
 * reading or writing outside the project artifact.
 *
 * @param {Record<string, unknown>} packageJson Parsed root package.json content.
 * @param {string} rootDir Project root directory.
 * @returns {Promise<DeclaredEntryPoint[]>} Validated source and output paths.
 * @throws {Error} If a declared entry point is malformed, escapes the project, or is missing.
 */
async function resolveDeclaredEntryPoints(packageJson: Record<string, unknown>, rootDir: string): Promise<DeclaredEntryPoint[]> {
  const automator = packageJson['automator'];
  if (typeof automator !== 'object' || automator === null || Array.isArray(automator)) return [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const entryPoints = (automator as Record<string, unknown>)['entryPoints'];
  if (!Array.isArray(entryPoints)) return [];

  const declaredEntryPoints: DeclaredEntryPoint[] = [];
  for (const [index, entryPoint] of entryPoints.entries()) {
    if (typeof entryPoint !== 'object' || entryPoint === null || Array.isArray(entryPoint)) {
      throw new Error(`Invalid automator.entryPoints[${index}]: expected an object with in and out strings`);
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const entry = entryPoint as Record<string, unknown>;
    const input = entry['in'];
    const output = entry['out'];
    if (typeof input !== 'string' || !input || typeof output !== 'string' || !output) {
      throw new Error(`Invalid automator.entryPoints[${index}]: in and out must be non-empty strings`);
    }
    const inputPath = path.resolve(rootDir, input);
    const relativeInput = path.relative(rootDir, inputPath);
    const outputPath = output.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.js$/, '');
    if (relativeInput.startsWith('..') || path.isAbsolute(relativeInput) || outputPath.split('/').includes('..') || path.posix.isAbsolute(outputPath)) {
      throw new Error(`Invalid automator.entryPoints[${index}]: paths must stay within the project and dist directories`);
    }
    if (!(await fileExists(inputPath))) {
      throw new Error(`Missing automator.entryPoints[${index}] source file: ${input}`);
    }
    logEsbuildAction('entryPoints', [input, '--out', output], rootDir);
    declaredEntryPoints.push({ in: inputPath, out: outputPath });
  }
  return declaredEntryPoints;
}

/**
 * Resolves package specifiers declared in an automator configuration field.
 *
 * Dependencies are external by default so npm installs them at runtime. `bundle`
 * opts a dependency into the esbuild artifact, while `external` explicitly preserves
 * a runtime import. The caller applies `external` after `bundle`, making an explicit
 * external declaration the safe final override when both list the same specifier.
 *
 * @param {Record<string, unknown>} packageJson Parsed root package.json content.
 * @param {'external' | 'bundle'} field Automator field to resolve.
 * @returns {string[]} Validated package specifiers.
 * @throws {Error} If the declaration is not an array of non-empty strings.
 */
function resolveDeclaredPackageSpecifiers(packageJson: Record<string, unknown>, field: 'external' | 'bundle'): string[] {
  const automator = packageJson['automator'];
  if (typeof automator !== 'object' || automator === null || Array.isArray(automator)) return [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const packageSpecifiers = (automator as Record<string, unknown>)[field];
  if (packageSpecifiers === undefined) return [];
  if (!Array.isArray(packageSpecifiers)) {
    throw new Error(`Invalid automator.${field}: expected an array of non-empty package specifiers`);
  }
  for (const [index, packageName] of packageSpecifiers.entries()) {
    if (typeof packageName !== 'string' || !packageName.trim()) {
      throw new Error(`Invalid automator.${field}[${index}]: expected a non-empty package specifier`);
    }
    logEsbuildAction(field, [packageName]);
  }
  return packageSpecifiers;
}

/**
 * Bundles the project with esbuild.
 *
 * Steps:
 * 1. Collect all `package.json` files: root and every workspace package.
 * 2. Build the set of local workspace package names (to be inlined, not external).
 * 3. Gather root and workspace dependencies into the `external` set, then remove
 *    local workspace names so they are inlined. `automator.bundle` removes explicit
 *    package specifiers from this set; `automator.external` adds them back and wins
 *    when both fields declare the same package.
 * 4. Read the root `package.json` to resolve the main entry point
 *    (`main` → `exports["."]["import"]` → throw), public export subpaths, bins,
 *    and optional `automator.entryPoints` and `automator.copyEntries` declarations.
 * 5. Build an esbuild-only `alias` map that redirects each local workspace package
 *    name and public subpath to TypeScript source. Aliases exist only during bundling
 *    and are never shipped as runtime module-resolution rules.
 * 6. Derive bundle entry points from the main field, public export targets, and bins.
 *    Bins outside `dist/` are bundled as JavaScript launchers; declared entry points
 *    add runtime-loaded modules such as workers.
 * 7. Run one `esbuild.build()` call with `splitting: true`, writing bundled output to
 *    `dist/`, then copy files matching declared `copyEntries` patterns into `dist/`.
 *
 * @param {EsbuildOptions} opts Esbuild options.
 * @returns {Promise<void>} Resolves when the bundle is written.
 * @throws {Error} If the root package.json is missing or malformed, or if no main entry
 */
export async function runEsbuild(opts: EsbuildOptions): Promise<void> {
  // Step 1: Collect all package.json files: root + workspace packages.
  const workspacePaths = await resolveWorkspacePackageJsonPaths(opts.rootDir);
  const allPkgPaths = [path.join(opts.rootDir, 'package.json'), ...workspacePaths];

  // Step 2: Collect local workspace package names — these will be inlined into the bundle.
  const localNames = new Set<string>();
  for (const wPkgPath of workspacePaths) {
    const wRaw = await readFile(wPkgPath, 'utf8');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const wPkg = JSON.parse(wRaw) as { name?: string };
    if (wPkg.name) localNames.add(wPkg.name);
  }

  // Step 3: Gather every dependency declared across root and all workspace packages,
  // then exclude local workspace names so they get inlined.
  const externalSet = new Set<string>();
  for (const pkgPath of allPkgPaths) {
    const pRaw = await readFile(pkgPath, 'utf8');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const pPkg = JSON.parse(pRaw) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    for (const dep of [...Object.keys(pPkg.dependencies ?? {}), ...Object.keys(pPkg.optionalDependencies ?? {}), ...Object.keys(pPkg.peerDependencies ?? {})]) {
      externalSet.add(dep);
    }
  }
  for (const localName of localNames) {
    externalSet.delete(localName);
  }
  // Bun-only adapters may be present in transitive dependencies. Node never
  // resolves them at runtime, but esbuild must leave their platform imports intact.
  externalSet.add('bun:*');
  if (await isPlugin(opts.rootDir)) externalSet.add('matterbridge'); // Always external, not bundled.

  // Step 4: Read root package.json to resolve main entry and bin entries.
  const rootPkg = (await parsePackageJson(opts.rootDir)) as {
    main?: string;
    exports?: Record<string, unknown> | string;
    bin?: Record<string, string>;
  } & Record<string, unknown>;
  for (const packageName of resolveDeclaredPackageSpecifiers(rootPkg, 'bundle')) {
    externalSet.delete(packageName);
  }
  for (const packageName of resolveDeclaredPackageSpecifiers(rootPkg, 'external')) {
    externalSet.add(packageName);
  }
  const declaredCopyEntries = await resolveDeclaredCopyEntries(rootPkg, opts.rootDir);

  // Derive the TypeScript source path from a dist output path.
  // e.g. "./dist/module.js" → in: "src/module.ts", out: "module"
  // e.g. "./dist/bin/hello.js" → in: "src/bin/hello.ts", out: "bin/hello"
  const toTsSrc = (relPath: string): string =>
    relPath
      .replace(/^\.?\//, '')
      .replace('dist/', 'src/')
      .replace(/\.js$/, '.ts');
  const toOutName = (relPath: string): string =>
    relPath
      .replace(/^\.?\//, '')
      .replace(/^dist\//, '')
      .replace(/\.js$/, '');

  const rootExports = typeof rootPkg.exports === 'object' && rootPkg.exports !== null ? rootPkg.exports : undefined;
  const rootExport = rootExports?.['.'];
  const exportsMain = typeof rootExport === 'object' && rootExport !== null && 'import' in rootExport && typeof rootExport.import === 'string' ? rootExport.import : undefined;
  const mainRel =
    rootPkg.main ??
    exportsMain ??
    ((): never => {
      throw new Error('No main entry point found in package.json (main or exports["."]["import"] required)');
    })();
  const binEntries = Object.entries(rootPkg.bin ?? {});

  // Step 5: Build an esbuild-only alias map — redirect each local workspace package
  // name to its TypeScript source so esbuild can inline it without dist/ needing to
  // exist. These aliases are consumed during bundling and are not shipped as runtime
  // module resolution rules.
  // e.g. "@monorepo/one" → "packages/one/src/module.ts"
  const alias: Record<string, string> = {};
  for (const wPkgPath of workspacePaths) {
    const wRaw = await readFile(wPkgPath, 'utf8');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const wPkg = JSON.parse(wRaw) as {
      name?: string;
      main?: string;
      exports?: Record<string, unknown> | string;
    };
    if (!wPkg.name) continue;
    const wExports = typeof wPkg.exports === 'object' && wPkg.exports !== null ? wPkg.exports : undefined;
    const rootExport = wExports?.['.'];
    const wExportsMain = typeof rootExport === 'object' && rootExport !== null && 'import' in rootExport && typeof rootExport.import === 'string' ? rootExport.import : undefined;
    const wMainRel = wPkg.main ?? wExportsMain;
    if (wMainRel) alias[wPkg.name] = path.join(path.dirname(wPkgPath), toTsSrc(wMainRel));
    if (!wExports) continue;
    for (const [exportPath, exportValue] of Object.entries(wExports)) {
      if (exportPath === '.' || !exportPath.startsWith('./')) continue;
      if (typeof exportValue !== 'object' || exportValue === null || !('import' in exportValue) || typeof exportValue.import !== 'string') continue;
      alias[`${wPkg.name}/${exportPath.slice(2)}`] = path.join(path.dirname(wPkgPath), toTsSrc(exportValue.import));
    }
  }

  // Step 6: Derive entryPoints from dist paths declared in package.json.
  // e.g. "./dist/module.js" → in: "src/module.ts", out: "module"
  // e.g. "./dist/bin/hello.js" → in: "src/bin/hello.ts", out: "bin/hello"
  //
  // For bin entries:
  // - Deduplicate by resolved absolute path (multiple bin names can map to the
  //   same file; only the first is kept).
  // - Resolve bins in `dist/` to their TypeScript sources (dist/bin/x.js →
  //   src/bin/x.ts). Other JavaScript bins are launchers and are bundled
  //   directly. This makes workspace imports in launchers self-contained.
  const seenBinPaths = new Set<string>();
  const resolvedBinEntries: Array<{ in: string; out: string }> = [];
  for (const [, binRelPath] of binEntries) {
    const normalizedBinPath = binRelPath.replace(/^\.\//, '');
    const derivedSrc = toTsSrc(normalizedBinPath);
    const sourcePath = normalizedBinPath.startsWith('dist/') && derivedSrc.endsWith('.ts') ? derivedSrc : normalizedBinPath;
    const srcPath = path.join(opts.rootDir, sourcePath);
    const absPath = path.resolve(srcPath);
    if (seenBinPaths.has(absPath)) continue;
    seenBinPaths.add(absPath);
    if (!(await fileExists(srcPath))) continue;
    resolvedBinEntries.push({ in: srcPath, out: toOutName(binRelPath) });
  }

  const entryPoints: Array<{ in: string; out: string }> = [{ in: path.join(opts.rootDir, toTsSrc(mainRel)), out: toOutName(mainRel) }, ...resolvedBinEntries];
  const outputPaths = new Set(entryPoints.map((entryPoint) => entryPoint.out));
  if (rootExports) {
    for (const [exportPath, exportValue] of Object.entries(rootExports)) {
      if (exportPath === '.' || !exportPath.startsWith('./')) continue;
      const exportTarget =
        typeof exportValue === 'string'
          ? exportValue
          : typeof exportValue === 'object' && exportValue !== null && 'import' in exportValue && typeof exportValue.import === 'string'
            ? exportValue.import
            : undefined;
      if (!exportTarget) continue;
      const outputPath = toOutName(exportTarget);
      if (outputPaths.has(outputPath)) continue;
      outputPaths.add(outputPath);
      entryPoints.push({ in: path.join(opts.rootDir, toTsSrc(exportTarget)), out: outputPath });
    }
  }
  const declaredEntryPoints = await resolveDeclaredEntryPoints(rootPkg, opts.rootDir);
  for (const declaredEntryPoint of declaredEntryPoints) {
    if (outputPaths.has(declaredEntryPoint.out)) {
      throw new Error(`Duplicate esbuild output path: ${declaredEntryPoint.out}`);
    }
    outputPaths.add(declaredEntryPoint.out);
    entryPoints.push(declaredEntryPoint);
  }

  // Step 7: Run esbuild — all entries in one call with code splitting.
  logEsbuild(entryPoints, opts.rootDir);
  const esbuildOptions: BuildOptions = {
    /** This is an array of files that each serve as an input to the bundling algorithm. They are called "entry points" because each one is meant to be the initial script that is
     * evaluated which then loads all other aspects of the code that it represents. */
    entryPoints,
    /** To bundle a file means to inline any imported dependencies into the file itself. This process is recursive so dependencies of dependencies (and so on) will also be inlined.
     *  By default esbuild will not bundle the input files. Bundling must be explicitly enabled. */
    bundle: true,
    /** This sets the output format for the generated JavaScript files. There are currently three possible values that can be configured: iife, cjs, and esm. */
    format: 'esm',
    /** By default, esbuild's bundler is configured to generate code intended for the browser. If your bundled code is intended to run in node instead, you should set the platform to node. */
    platform: 'node',
    /** This sets the target environment for the generated JavaScript and/or CSS code. */
    target: ['esnext'],
    /** Esbuild-only substitutions that inline workspace source files while bundling; they are not runtime aliases in the packed artifact. */
    alias,
    /** You can mark a file or a package as external to exclude it from your build. Instead of being bundled, the import will be preserved (using require for the iife
     * and cjs formats and using import for the esm format) and will be evaluated at run time instead. */
    external: [...externalSet],
    /** Tree shaking is the term the JavaScript community uses for dead code elimination, a common compiler optimization that automatically removes unreachable code.
     * Within esbuild, this term specifically refers to declaration-level dead code removal. */
    treeShaking: true,
    /** This enables "code splitting" which serves two purposes:
     * - Code shared between multiple entry points is split off into a separate shared file that both entry points import.
     * - Code referenced through an asynchronous import() expression will be split off into a separate file and only loaded when that expression is evaluated. */
    splitting: true,
    /** This option sets the output directory for the build operation. */
    outdir: path.join(opts.rootDir, 'dist'),
    /** The build API call can either write to the file system directly or return the files that would have been written as in-memory buffers. */
    write: true,
    /** When enabled, the generated code will be minified instead of pretty-printed. Minified code is generally equivalent to non-minified code but is smaller, which means it
     * downloads faster but is harder to debug. Usually you minify code in production but not in development. */
    minify: opts.minify ?? false,
    /** This option controls whether whitespace is minified. */
    minifyWhitespace: opts.minify ?? false,
    /** This option controls how legal comments are handled in the output files. */
    legalComments: opts.minify ? 'none' : 'inline',
    /** This sets the log level for esbuild. */
    logLevel: 'info',
  };
  logEsbuildOptions(JSON.stringify(esbuildOptions, null, 2), opts.rootDir);
  if (opts.dryRun) {
    return;
  }
  await build(esbuildOptions);
  await copyDeclaredEntries(declaredCopyEntries, opts.rootDir);
}
