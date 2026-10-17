/**
 * @file src/dts.ts
 * @description This file contains declaration-bundling utilities for packed libraries.
 * @author Luca Liguori
 * @created 2026-06-24
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

import path from 'node:path';

import { runBin } from './build.js';
import { resolveWorkspacePackageJsonPaths } from './cache.js';
import { fileExists } from './clean.js';
import { isMonorepo, parsePackageJson } from './helpers.js';

/** Context shared by declaration-bundling operations. */
export interface DtsOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** True when running on Windows. */
  isWindows: boolean;
  /** When true, log but skip command execution and file-system writes. */
  dryRun: boolean;
}

/** A generated declaration file that is both the Rollup input and output. */
interface DeclarationEntryPoint {
  /** Absolute declaration file path. */
  filePath: string;
}

/**
 * Rebuilds declaration files for library packages.
 *
 * Reruns TypeScript in declaration-only mode after JavaScript bundling, producing the
 * per-file declarations that {@link runDtsBundle} then bundles. Monorepos build their
 * project references with `--force`: `tsc --build` trusts its `.tsbuildinfo` files and
 * would otherwise skip re-emitting the declarations that esbuild just pruned.
 *
 * @param {DtsOptions} opts Declaration build options.
 * @returns {Promise<void>} Resolves when declaration emit completes.
 */
export async function runDtsBuild(opts: DtsOptions): Promise<void> {
  const tsconfigPath = path.join(opts.rootDir, 'tsconfig.build.json');
  const args = (await isMonorepo(opts.rootDir))
    ? ['--build', tsconfigPath, '--force', '--declaration', '--declarationMap', 'false', '--emitDeclarationOnly']
    : ['--project', tsconfigPath, '--incremental', 'false', '--composite', 'false', '--declaration', '--declarationMap', 'false', '--emitDeclarationOnly'];

  await runBin('tsc', args, { rootDir: opts.rootDir, isWindows: opts.isWindows, dryRun: opts.dryRun, mode: 'build', watch: false });
}

/**
 * Bundles generated declaration files for every public package export.
 *
 * Local workspace declarations are inlined so the packed package has no type-level
 * dependency on unshipped workspace packages. Third-party dependencies remain external.
 *
 * Every entry is bundled in one Rollup run, so declarations shared by several entries go into
 * common chunks under `dist/_chunks/`. Bundling each entry on its own would give every entry
 * its own copy of a shared class: TypeScript treats two declarations of a class with private
 * members as different types, so a subclass from one subpath (`pkg/devices`) would not be
 * assignable where another subpath (`pkg`) expects the base class.
 *
 * `rollup-plugin-dts` needs the classic compiler API that TypeScript 7 removed; it loads
 * it from the `@typescript/typescript6` compatibility package installed next to `typescript` 7.
 *
 * @param {Pick<DtsOptions, 'rootDir' | 'dryRun'>} opts Declaration-bundling options.
 * @returns {Promise<string[]>} Absolute paths of every written declaration file, entries and shared chunks (empty on dry run).
 * @throws {Error} If a library declaration target is missing after the declaration build.
 */
export async function runDtsBundle(opts: Pick<DtsOptions, 'rootDir' | 'dryRun'>): Promise<string[]> {
  if (opts.dryRun) return [];

  const packageJson = await parsePackageJson(opts.rootDir);
  const declarationPaths = new Set<string>();
  if (typeof packageJson['types'] === 'string') declarationPaths.add(packageJson['types']);
  const packageExports = packageJson['exports'];
  if (typeof packageExports === 'object' && packageExports !== null && !Array.isArray(packageExports)) {
    for (const exportValue of Object.values(packageExports)) {
      if (typeof exportValue !== 'object' || exportValue === null || Array.isArray(exportValue)) continue;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const declarationPath = (exportValue as Record<string, unknown>)['types'];
      if (typeof declarationPath === 'string') declarationPaths.add(declarationPath);
    }
  }

  const entryPoints: DeclarationEntryPoint[] = [];
  for (const declarationPath of declarationPaths) {
    const filePath = path.resolve(opts.rootDir, declarationPath);
    if (!(await fileExists(filePath))) {
      throw new Error(`Missing declaration file for packed library: ${declarationPath}`);
    }
    entryPoints.push({ filePath });
  }
  if (entryPoints.length === 0) return [];

  const workspaceDeclarationPaths: Record<string, string[]> = {};
  for (const packageJsonPath of await resolveWorkspacePackageJsonPaths(opts.rootDir)) {
    const workspacePackage = await parsePackageJson(path.dirname(packageJsonPath));
    if (typeof workspacePackage['name'] !== 'string') continue;
    const workspaceName = workspacePackage['name'];
    const workspaceDirectory = path.dirname(packageJsonPath);
    const toDeclarationPath = (declarationPath: string): string => path.relative(opts.rootDir, path.resolve(workspaceDirectory, declarationPath)).split(path.sep).join('/');
    const workspaceTypes = workspacePackage['types'];
    if (typeof workspaceTypes === 'string') {
      workspaceDeclarationPaths[workspaceName] = [toDeclarationPath(workspaceTypes)];
    }
    const workspaceExports = workspacePackage['exports'];
    if (typeof workspaceExports !== 'object' || workspaceExports === null || Array.isArray(workspaceExports)) continue;
    for (const [exportPath, exportValue] of Object.entries(workspaceExports)) {
      if (typeof exportValue !== 'object' || exportValue === null || Array.isArray(exportValue)) continue;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const declarationPath = (exportValue as Record<string, unknown>)['types'];
      if (typeof declarationPath !== 'string') continue;
      const importPath = exportPath === '.' ? workspaceName : `${workspaceName}/${exportPath.replace(/^\.\//, '')}`;
      workspaceDeclarationPaths[importPath] = [toDeclarationPath(declarationPath)];
    }
  }

  // Lazily import declaration bundling to avoid loading Rollup and the TypeScript 6 compiler
  // in command paths that never bundle declarations.
  const { rollup } = await import('rollup');
  const { dts } = await import('rollup-plugin-dts');
  // Name each entry by its path relative to the root without `.d.ts`, so `[name].d.ts` writes it back in place.
  const input: Record<string, string> = {};
  for (const entryPoint of entryPoints) {
    input[
      path
        .relative(opts.rootDir, entryPoint.filePath)
        .split(path.sep)
        .join('/')
        .replace(/\.d\.ts$/, '')
    ] = entryPoint.filePath;
  }
  const bundle = await rollup({
    input,
    external: (specifier) => !specifier.startsWith('.') && !path.isAbsolute(specifier) && !Object.hasOwn(workspaceDeclarationPaths, specifier),
    plugins: [dts({ respectExternal: true, compilerOptions: { baseUrl: opts.rootDir, paths: workspaceDeclarationPaths } })],
  });
  const { output } = await bundle.write({ dir: opts.rootDir, format: 'es', entryFileNames: '[name].d.ts', chunkFileNames: 'dist/_chunks/[name]-[hash].d.ts' });
  await bundle.close();
  return output.map((file) => path.resolve(opts.rootDir, file.fileName));
}
