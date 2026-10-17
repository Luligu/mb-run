/**
 * @file src/esbuild.ts
 * @description This file contains esbuild bundle utilities for the mb-run command.
 * @author Luca Liguori
 * @created 2026-05-03
 * @version 1.1.0
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

import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import path from 'node:path';

import { build, type BuildOptions, type Plugin } from 'esbuild';

import { resolveWorkspacePackageJsonPaths } from './cache.js';
import { fileExists } from './clean.js';
import { runDtsBuild, runDtsBundle } from './dts.js';
import { isLibrary, isPlugin, parsePackageJson } from './helpers.js';
import { logEsbuild, logEsbuildAction, logEsbuildOptions, logWarning } from './logger.js';

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
  /** When true, obfuscate the generated JavaScript with javascript-obfuscator. */
  obfuscate?: boolean;
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
 * Resolves compiled file trees declared in `automator.esbuild.copyEntries`.
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
  const esbuild = (automator as Record<string, unknown>)['esbuild'];
  if (typeof esbuild !== 'object' || esbuild === null || Array.isArray(esbuild)) return [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const copyEntries = (esbuild as Record<string, unknown>)['copyEntries'];
  if (!Array.isArray(copyEntries)) return [];
  const entries: DeclaredCopyEntry[] = [];
  for (const [index, copyEntry] of copyEntries.entries()) {
    if (typeof copyEntry !== 'object' || copyEntry === null || Array.isArray(copyEntry)) throw new Error(`Invalid automator.esbuild.copyEntries[${index}]: expected an object`);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const entry = copyEntry as Record<string, unknown>;
    const from = entry['from'];
    const to = entry['to'];
    const include = entry['include'];
    if (typeof from !== 'string' || !from || typeof to !== 'string' || !to || !Array.isArray(include) || include.some((pattern) => typeof pattern !== 'string' || !pattern)) {
      throw new Error(`Invalid automator.esbuild.copyEntries[${index}]: from, to, and include must be non-empty strings`);
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
      throw new Error(`Invalid automator.esbuild.copyEntries[${index}]: paths must stay within the project and source directory must exist`);
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
 * Copies files declared by `automator.esbuild.copyEntries` into `dist/`.
 *
 * Esbuild runs before this copy step. For each validated entry, every file under
 * `from` is tested against `include` using its path relative to `from`; matching
 * files are written to `dist/<to>/<relative path>`. Existing files at those
 * destinations are overwritten, which lets packages replace selected bundled
 * outputs with precompiled static ESM façades such as `export * from '@matter/main'`.
 *
 * @example
 * ```json
 * {
 *   "automator": {
 *     "esbuild": {
 *       "copyEntries": [
 *         {
 *           "from": "packages/core/dist/matter",
 *           "to": "matter",
 *           "include": ["*.js"]
 *         }
 *       ]
 *     }
 *   }
 * }
 * ```
 *
 * With that declaration, `packages/core/dist/matter/export.js` is copied to
 * `dist/matter/export.js`, while files that do not match `*.js` are skipped.
 *
 * @param {DeclaredCopyEntry[]} entries Validated copy entries.
 * @param {string} rootDir Project root directory.
 * @returns {Promise<string[]>} Absolute destination paths of every copied file.
 */
async function copyDeclaredEntries(entries: DeclaredCopyEntry[], rootDir: string): Promise<string[]> {
  const copiedPaths: string[] = [];
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
          copiedPaths.push(destinationPath);
        }
      }
    };
    await copyDirectory(entry.from, '');
  }
  return copiedPaths;
}

/**
 * Obfuscates JavaScript files written by esbuild, in place.
 *
 * Uses the same javascript-obfuscator settings as the vendored `scripts/esbuild.mjs`.
 * `renameGlobals: false` keeps top-level names intact, so the ESM imports and exports
 * that connect entry points and shared chunks keep working. A leading shebang (bin
 * launchers) is set aside before obfuscation and restored on the first line afterwards.
 *
 * @param {string[]} filePaths Absolute paths of the JavaScript files to obfuscate.
 * @param {string} rootDir Project root directory, used for logging.
 * @returns {Promise<void>} Resolves when every file is rewritten.
 */
async function obfuscateOutputs(filePaths: string[], rootDir: string): Promise<void> {
  // Lazily load the obfuscator: it is large and only needed when obfuscation is requested.
  const { default: JavaScriptObfuscator } = await import('javascript-obfuscator');
  for (const filePath of filePaths) {
    logEsbuildAction('obfuscate', [filePath], rootDir);
    const code = await readFile(filePath, 'utf8');
    const shebang = /^#![^\n]*\n/.exec(code)?.[0] ?? '';
    const obfuscated = JavaScriptObfuscator.obfuscate(code.slice(shebang.length), {
      compact: true,
      renameGlobals: false,
      identifierNamesGenerator: 'hexadecimal',
      stringArray: true,
      stringArrayThreshold: 0.8,
      splitStrings: true,
      splitStringsChunkLength: 10,
      sourceMap: false,
    }).getObfuscatedCode();
    await writeFile(filePath, `${shebang}${obfuscated}\n`, 'utf8');
  }
}

/**
 * Deletes every file under `dist/` that this esbuild run did not produce or keep.
 *
 * Compiling each source file individually (via `tsc`) leaves plain per-file compiled
 * JavaScript in `dist/`; once esbuild bundles the project, those files are superseded by
 * the entry, chunk, and copied outputs actually needed at runtime, but nothing else removes
 * them. Declaration files are produced separately by `tsc`; library packages rebuild them
 * after esbuild with declaration-only emit, bundle them with `rollup-plugin-dts`, then
 * prune again so only the bundled declaration entries remain.
 *
 * @param {string} distDir Absolute path to the dist directory.
 * @param {Set<string>} keepPaths Absolute file paths that must survive: esbuild outputs, copyEntries destinations and bundled declarations.
 * @returns {Promise<void>} Resolves when every unproduced file, and any directory left empty by their removal, is deleted.
 */
async function pruneUnproducedDistFiles(distDir: string, keepPaths: Set<string>): Promise<void> {
  if (!(await fileExists(distDir))) return;

  const pruneDirectory = async (directory: string): Promise<boolean> => {
    let isEmpty = true;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (await pruneDirectory(entryPath)) await rm(entryPath, { recursive: true, force: true });
        else isEmpty = false;
      } else if (keepPaths.has(entryPath)) {
        isEmpty = false;
      } else {
        logEsbuildAction('prune', [entryPath]);
        await rm(entryPath, { force: true });
      }
    }
    return isEmpty;
  };
  await pruneDirectory(distDir);
}

/**
 * Resolves additional runtime entry points declared in `automator.esbuild.entryPoints`.
 *
 * Main, public exports, and npm bins are discovered automatically, but workers and
 * other files loaded later by path are invisible to that discovery. These declarations
 * make them explicit esbuild inputs and place their self-contained outputs at stable
 * paths under dist. Source and output validation prevents a package manifest from
 * reading or writing outside the project artifact.
 *
 * @example
 * ```json
 * {
 *   "automator": {
 *     "esbuild": {
 *       "entryPoints": [
 *         {
 *           "in": "src/workers/bridge-worker.ts",
 *           "out": "workers/bridge-worker"
 *         }
 *       ]
 *     }
 *   }
 * }
 * ```
 *
 * With that declaration, `src/workers/bridge-worker.ts` is bundled as an
 * additional esbuild entry and written to `dist/workers/bridge-worker.js`.
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
  const esbuild = (automator as Record<string, unknown>)['esbuild'];
  if (typeof esbuild !== 'object' || esbuild === null || Array.isArray(esbuild)) return [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const entryPoints = (esbuild as Record<string, unknown>)['entryPoints'];
  if (!Array.isArray(entryPoints)) return [];

  const declaredEntryPoints: DeclaredEntryPoint[] = [];
  for (const [index, entryPoint] of entryPoints.entries()) {
    if (typeof entryPoint !== 'object' || entryPoint === null || Array.isArray(entryPoint)) {
      throw new Error(`Invalid automator.esbuild.entryPoints[${index}]: expected an object with in and out strings`);
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const entry = entryPoint as Record<string, unknown>;
    const input = entry['in'];
    const output = entry['out'];
    if (typeof input !== 'string' || !input || typeof output !== 'string' || !output) {
      throw new Error(`Invalid automator.esbuild.entryPoints[${index}]: in and out must be non-empty strings`);
    }
    const inputPath = path.resolve(rootDir, input);
    const relativeInput = path.relative(rootDir, inputPath);
    const outputPath = output.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.js$/, '');
    if (relativeInput.startsWith('..') || path.isAbsolute(relativeInput) || outputPath.split('/').includes('..') || path.posix.isAbsolute(outputPath)) {
      throw new Error(`Invalid automator.esbuild.entryPoints[${index}]: paths must stay within the project and dist directories`);
    }
    if (!(await fileExists(inputPath))) {
      throw new Error(`Missing automator.esbuild.entryPoints[${index}] source file: ${input}`);
    }
    logEsbuildAction('entryPoints', [input, '--out', output], rootDir);
    declaredEntryPoints.push({ in: inputPath, out: outputPath });
  }
  return declaredEntryPoints;
}

/**
 * Resolves package specifiers declared in `automator.esbuild.bundle` or
 * `automator.esbuild.external`.
 *
 * Dependencies are external by default so npm installs them at runtime. `bundle`
 * opts a dependency into the esbuild artifact, while `external` explicitly preserves
 * a runtime import. The caller applies `external` after `bundle`, making an explicit
 * external declaration the safe final override when both list the same specifier.
 *
 * @param {Record<string, unknown>} packageJson Parsed root package.json content.
 * @param {'external' | 'bundle'} field `automator.esbuild` field to resolve.
 * @returns {string[]} Validated package specifiers.
 * @throws {Error} If the declaration is not an array of non-empty strings.
 */
function resolveDeclaredPackageSpecifiers(packageJson: Record<string, unknown>, field: 'external' | 'bundle'): string[] {
  const automator = packageJson['automator'];
  if (typeof automator !== 'object' || automator === null || Array.isArray(automator)) return [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const esbuild = (automator as Record<string, unknown>)['esbuild'];
  if (typeof esbuild !== 'object' || esbuild === null || Array.isArray(esbuild)) return [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const packageSpecifiers = (esbuild as Record<string, unknown>)[field];
  if (packageSpecifiers === undefined) return [];
  if (!Array.isArray(packageSpecifiers)) {
    throw new Error(`Invalid automator.esbuild.${field}: expected an array of non-empty package specifiers`);
  }
  for (const [index, packageName] of packageSpecifiers.entries()) {
    if (typeof packageName !== 'string' || !packageName.trim()) {
      throw new Error(`Invalid automator.esbuild.${field}[${index}]: expected a non-empty package specifier`);
    }
    logEsbuildAction(field, [packageName]);
  }
  return packageSpecifiers;
}

/**
 * Returns the package name of a bare import specifier.
 *
 * @param {string} specifier Bare import specifier, e.g. `@scope/pkg/sub` or `pkg/sub`.
 * @returns {string} The package name, e.g. `@scope/pkg` or `pkg`.
 */
function toPackageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Reports whether an import specifier matches one of the declared package patterns.
 *
 * A pattern matches its exact specifier, every subpath of the package it names, and, when it
 * ends with `*` (as esbuild's `external` allows), every specifier starting with its prefix.
 *
 * @param {string} specifier Bare import specifier.
 * @param {Iterable<string>} patterns Package names or `*` patterns.
 * @returns {boolean} True when a pattern matches.
 */
function matchesPackagePattern(specifier: string, patterns: Iterable<string>): boolean {
  for (const pattern of patterns) {
    if (pattern.endsWith('*') ? specifier.startsWith(pattern.slice(0, -1)) : specifier === pattern || toPackageName(specifier) === pattern) return true;
  }
  return false;
}

/**
 * Creates an esbuild plugin that keeps every package import external, unless it is a local
 * workspace package (inlined through the alias map) or opted in with `automator.esbuild.bundle`.
 *
 * Only declared dependencies were external before, so a package imported without being declared
 * (typically a hoisted transitive dependency, like `@matter/general` under `@matter/main`) was
 * silently bundled: the process then loaded two copies of it, the bundled one and the one its
 * declared parent imports at runtime. Such packages now stay external and are collected so the
 * caller can warn that npm installs them only by chance.
 *
 * @param {Set<string>} localNames Local workspace package names.
 * @param {string[]} bundledPatterns Packages declared in `automator.esbuild.bundle`.
 * @param {Set<string>} declaredPatterns Packages declared as dependencies or external, which need no warning.
 * @param {Set<string>} undeclaredPackages Receives the imported packages that nothing declares.
 * @returns {Plugin} The esbuild plugin.
 */
function createExternalPackagesPlugin(localNames: Set<string>, bundledPatterns: string[], declaredPatterns: Set<string>, undeclaredPackages: Set<string>): Plugin {
  return {
    name: 'mb-run-external-packages',
    setup(build) {
      build.onResolve({ filter: /^[^./]/ }, (args) => {
        // oxlint-disable-next-line unicorn/no-useless-undefined -- keeps every branch's return type consistent with the object-returning branch below
        if (args.kind === 'entry-point' || path.isAbsolute(args.path)) return undefined;
        const packageName = toPackageName(args.path);
        // oxlint-disable-next-line unicorn/no-useless-undefined -- keeps every branch's return type consistent with the object-returning branch below
        if (localNames.has(packageName) || matchesPackagePattern(args.path, bundledPatterns)) return undefined;
        if (!args.path.includes(':') && !isBuiltin(args.path) && !matchesPackagePattern(args.path, declaredPatterns)) undeclaredPackages.add(packageName);
        return { path: args.path, external: true };
      });
    },
  };
}

/**
 * Creates an esbuild plugin that redirects a relative import of a compiled `dist/` file back
 * to the TypeScript source that produces it, wherever that source exists.
 *
 * A launcher such as a bin script commonly imports already-compiled output by relative path
 * (e.g. `../dist/module.js`) so the launcher stays self-contained. Left
 * alone, esbuild would bundle each of those imports by reading whatever is on disk at that
 * path as plain text — files that are also this build's own output, duplicating their code
 * instead of sharing it, and colliding when both are produced in the same build. Redirecting
 * every such import to its matching TypeScript source makes esbuild compile it as the same
 * module every other entry point already bundles, so `splitting` can share it in one chunk
 * instead of duplicating it.
 *
 * @returns {Plugin} The esbuild plugin.
 */
function createOwnOutputRedirectPlugin(): Plugin {
  return {
    name: 'redirect-own-dist-outputs',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^\.\.?\// }, async (args) => {
        // oxlint-disable-next-line unicorn/no-useless-undefined -- keeps every branch's return type consistent with the object-returning branch below
        if (!args.path.endsWith('.js')) return undefined;
        const resolved = path.resolve(args.resolveDir, args.path);
        const segments = resolved.split(path.sep);
        const distIndex = segments.lastIndexOf('dist');
        // oxlint-disable-next-line unicorn/no-useless-undefined -- keeps every branch's return type consistent with the object-returning branch below
        if (distIndex === -1) return undefined;
        const sourcePath = [...segments.slice(0, distIndex), 'src', ...segments.slice(distIndex + 1)].join(path.sep).replace(/\.js$/, '.ts');
        return (await fileExists(sourcePath)) ? { path: sourcePath } : undefined;
      });
    },
  };
}

/**
 * Bundles the project with esbuild.
 *
 * Automator configuration used:
 * - `automator.esbuild.bundle`: package specifiers to include in the bundle.
 * - `automator.esbuild.external`: package specifiers to preserve as runtime imports.
 * - `automator.esbuild.entryPoints`: additional `{ in, out }` runtime entry points.
 * - `automator.esbuild.copyEntries`: additional `{ from, to, include }` file trees to copy.
 *
 * Steps:
 * 1. Collect all `package.json` files: root and every workspace package.
 * 2. Build the set of local workspace package names (to be inlined, not external).
 * 3. Gather root and workspace dependencies into the `external` set, then remove
 *    local workspace names so they are inlined. `automator.esbuild.bundle` removes explicit
 *    package specifiers from this set; `automator.esbuild.external` adds them back and wins
 *    when both fields declare the same package. Every other package import also stays
 *    external (only workspace packages and `bundle` entries are inlined), and imported
 *    packages that no `package.json` declares are reported with a warning.
 * 4. Read the root `package.json` to resolve the main entry point
 *    (`main` → `exports["."]["import"]` → throw), public export subpaths, bins,
 *    and optional `automator.esbuild.entryPoints` and `automator.esbuild.copyEntries` declarations.
 * 5. Build an esbuild-only `alias` map that redirects each local workspace package
 *    name and public subpath to TypeScript source. Aliases exist only during bundling
 *    and are never shipped as runtime module-resolution rules.
 * 6. Derive bundle entry points from the main field, public export targets, and bins.
 *    Bins outside `dist/` are bundled as JavaScript launchers; declared entry points
 *    add runtime-loaded modules such as workers. A launcher's relative import of this
 *    build's own dist output (e.g. `../dist/module.js`) is redirected to that output's
 *    TypeScript source via an esbuild plugin, so it compiles as the same module and
 *    `splitting` can share it in one chunk instead of duplicating it.
 * 7. Run one `esbuild.build()` call with `splitting: true`, writing bundled output to
 *    `dist/`, then copy files matching declared `copyEntries` patterns into `dist/`.
 *    With `obfuscate`, every JavaScript file esbuild wrote is then obfuscated in place.
 * 8. Delete every file under `dist/` that step 7 did not produce or copy: leftover
 *    per-file JavaScript and declarations from an earlier plain `tsc` build. Library
 *    packages recreate declarations after esbuild with declaration-only emit.
 * 9. Build declarations for packages that publish types, then bundle each public
 *    declaration entry with `rollup-plugin-dts`, inlining local workspace declarations,
 *    and delete every per-file declaration the bundles superseded.
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
    const wPkg: { name?: string } = JSON.parse(wRaw);
    if (wPkg.name) localNames.add(wPkg.name);
  }

  // Step 3: Gather every dependency declared across root and all workspace packages,
  // then exclude local workspace names so they get inlined.
  const externalSet = new Set<string>();
  for (const pkgPath of allPkgPaths) {
    const pRaw = await readFile(pkgPath, 'utf8');
    const pPkg: {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    } = JSON.parse(pRaw);
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
  // matterbridge is always external, not bundled.
  if (await isPlugin(opts.rootDir)) externalSet.add('matterbridge');

  // Step 4: Read root package.json to resolve main entry and bin entries.
  const rootPkg = (await parsePackageJson(opts.rootDir)) as {
    main?: string;
    exports?: Record<string, unknown> | string;
    bin?: Record<string, string>;
  } & Record<string, unknown>;
  const bundledPatterns = resolveDeclaredPackageSpecifiers(rootPkg, 'bundle');
  for (const packageName of bundledPatterns) {
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

  const entryPoints: Array<{ in: string; out: string }> = [{ in: path.join(opts.rootDir, toTsSrc(mainRel)), out: toOutName(mainRel) }];
  const outputPaths = new Set([...entryPoints, ...resolvedBinEntries].map((entryPoint) => entryPoint.out));
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

  const allEntryPoints = [...entryPoints, ...resolvedBinEntries];
  const undeclaredPackages = new Set<string>();

  // Step 7: Run esbuild — all entries in one call with code splitting.
  logEsbuild(allEntryPoints, opts.rootDir);
  const esbuildOptions = {
    /** This is an array of files that each serve as an input to the bundling algorithm. They are called "entry points" because each one is meant to be the initial script that is
     * evaluated which then loads all other aspects of the code that it represents. */
    entryPoints: allEntryPoints,
    /** Redirects a launcher's relative import of a compiled dist file to its TypeScript
     * source, so shared code compiles once and can be split into a shared chunk. */
    plugins: [createOwnOutputRedirectPlugin(), createExternalPackagesPlugin(localNames, bundledPatterns, new Set([...externalSet, ...localNames]), undeclaredPackages)],
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
    /** Resolves relative entry and output paths against the project root regardless of the
     * current working directory, so the metafile's output paths below resolve predictably. */
    absWorkingDir: opts.rootDir,
    /** The build API call can either write to the file system directly or return the files that would have been written as in-memory buffers. */
    write: true,
    /** Records every output file this build produced, so leftover per-file compiled JavaScript
     * that predates this bundle can be told apart from this run's own outputs and pruned. */
    metafile: true,
    /** When enabled, the generated code will be minified instead of pretty-printed. Minified code is generally equivalent to non-minified code but is smaller, which means it
     * downloads faster but is harder to debug. Usually you minify code in production but not in development. */
    minify: opts.minify ?? false,
    /** This option controls whether whitespace is minified. */
    minifyWhitespace: opts.minify ?? false,
    /** This option controls how legal comments are handled in the output files. */
    legalComments: opts.minify ? 'none' : 'inline',
    /** This sets the log level for esbuild. */
    logLevel: 'info',
  } satisfies BuildOptions;
  logEsbuildOptions(JSON.stringify(esbuildOptions, null, 2), opts.rootDir);
  if (opts.dryRun) {
    if (await isLibrary(opts.rootDir)) await runDtsBuild({ rootDir: opts.rootDir, isWindows: opts.isWindows, dryRun: opts.dryRun });
    return;
  }
  const result = await build(esbuildOptions);
  if (undeclaredPackages.size > 0) {
    logWarning(`Imported but not declared in any package.json dependencies, kept external: ${[...undeclaredPackages].toSorted().join(', ')}. Declare them so npm installs them.`);
  }
  const copiedPaths = await copyDeclaredEntries(declaredCopyEntries, opts.rootDir);
  if (opts.obfuscate) {
    const javascriptOutputs = Object.keys(result.metafile.outputs).filter((outputPath) => outputPath.endsWith('.js'));
    await obfuscateOutputs(
      javascriptOutputs.map((outputPath) => path.resolve(opts.rootDir, outputPath)),
      opts.rootDir,
    );
  }

  // Step 8: Remove leftover per-file compiled JavaScript that this run superseded.
  const keepPaths = new Set([...Object.keys(result.metafile.outputs).map((outputPath) => path.resolve(opts.rootDir, outputPath)), ...copiedPaths]);
  await pruneUnproducedDistFiles(path.join(opts.rootDir, 'dist'), keepPaths);

  // Step 9: Build and bundle declarations for packages that publish types, then remove the per-file declarations they superseded.
  if (await isLibrary(opts.rootDir)) {
    await runDtsBuild({ rootDir: opts.rootDir, isWindows: opts.isWindows, dryRun: opts.dryRun });
    const bundledDeclarations = await runDtsBundle({ rootDir: opts.rootDir, dryRun: opts.dryRun });
    await pruneUnproducedDistFiles(path.join(opts.rootDir, 'dist'), new Set([...keepPaths, ...bundledDeclarations]));
  }
}
