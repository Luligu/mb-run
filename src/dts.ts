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

import { rollup } from 'rollup';
import { dts } from 'rollup-plugin-dts';

import { resolveWorkspacePackageJsonPaths } from './cache.js';
import { fileExists } from './clean.js';
import { parsePackageJson } from './helpers.js';

/** Context shared by declaration-bundling operations. */
export interface DtsOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** When true, log but skip command execution and file-system writes. */
  dryRun: boolean;
}

/** A generated declaration file that is both the Rollup input and output. */
interface DeclarationEntryPoint {
  /** Absolute declaration file path. */
  filePath: string;
}

/**
 * Bundles generated declaration files for every public package export.
 *
 * Local workspace declarations are inlined so the packed package has no type-level
 * dependency on unshipped workspace packages. Third-party dependencies remain external.
 *
 * @param {DtsOptions} opts Declaration-bundling options.
 * @returns {Promise<void>} Resolves when every public declaration file is bundled.
 * @throws {Error} If a library declaration target is missing after the production build.
 */
export async function runDtsBundle(opts: DtsOptions): Promise<void> {
  if (opts.dryRun) return;

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
  if (entryPoints.length === 0) return;

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

  for (const entryPoint of entryPoints) {
    const bundle = await rollup({
      input: entryPoint.filePath,
      external: (specifier) => !specifier.startsWith('.') && !path.isAbsolute(specifier) && !Object.hasOwn(workspaceDeclarationPaths, specifier),
      plugins: [dts({ respectExternal: true, compilerOptions: { baseUrl: opts.rootDir, paths: workspaceDeclarationPaths } })],
    });
    await bundle.write({ file: entryPoint.filePath, format: 'es' });
    await bundle.close();
  }
}
