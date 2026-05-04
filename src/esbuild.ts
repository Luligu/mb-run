/**
 * @description This file contains esbuild bundle utilities for the mb-run command.
 * @file esbuild.ts
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

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { build, type BuildOptions } from 'esbuild';

import { resolveWorkspacePackageJsonPaths } from './cache.js';
import { logEsbuild } from './logger.js';

/** Context shared by all esbuild operations. */
export interface EsbuildOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** True when running on Windows. */
  isWindows: boolean;
  /** When true, log but skip command execution and file-system writes. */
  dryRun: boolean;
}

/**
 * Bundles the project with esbuild.
 *
 * Steps:
 * 1. Collect all `package.json` files: root and every workspace package.
 * 2. Build the set of local workspace package names (to be inlined, not external).
 * 3. Gather all `dependencies` from root and workspace packages into the
 *    `external` set, then remove local workspace names so they are inlined.
 * 4. Read the root `package.json` to resolve the main entry point
 *    (`main` → `exports["."]["import"]` → throw) and the `bin` entries.
 * 5. Build an `alias` map that redirects each local workspace package name to
 *    its TypeScript source file so esbuild can inline it without `dist/`.
 * 6. Derive TypeScript `entryPoints` from the dist output paths declared in
 *    `package.json` (`dist/ → src/`, `.js → .ts`) and collect them together
 *    with all bin entries.
 * 7. Run a single `esbuild.build()` call with `splitting: true`, writing all
 *    output to `dist/`.
 *
 * @param {EsbuildOptions} opts Esbuild options.
 * @returns {Promise<void>} Resolves when the bundle is written.
 * @throws {Error} If the root package.json is missing or malformed, or if no main entry
 */
export async function runEsbuild(opts: EsbuildOptions): Promise<void> {
  if (opts.dryRun) return;

  // Step 1: Collect all package.json files: root + workspace packages.
  const workspacePaths = await resolveWorkspacePackageJsonPaths(opts.rootDir);
  const allPkgPaths = [path.join(opts.rootDir, 'package.json'), ...workspacePaths];

  // Step 2: Collect local workspace package names — these will be inlined into the bundle.
  const localNames = new Set<string>();
  for (const wPkgPath of workspacePaths) {
    const wRaw = await readFile(wPkgPath, 'utf8');
    const wPkg = JSON.parse(wRaw) as { name?: string };
    if (wPkg.name) localNames.add(wPkg.name);
  }

  // Step 3: Gather every dependency declared across root and all workspace packages,
  // then exclude local workspace names so they get inlined.
  const externalSet = new Set<string>();
  for (const pkgPath of allPkgPaths) {
    const pRaw = await readFile(pkgPath, 'utf8');
    const pPkg = JSON.parse(pRaw) as { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
    for (const dep of [...Object.keys(pPkg.dependencies ?? {}), ...Object.keys(pPkg.optionalDependencies ?? {}), ...Object.keys(pPkg.peerDependencies ?? {})]) {
      externalSet.add(dep);
    }
  }
  for (const localName of localNames) {
    externalSet.delete(localName);
  }

  // Step 4: Read root package.json to resolve main entry and bin entries.
  const rootRaw = await readFile(path.join(opts.rootDir, 'package.json'), 'utf8');
  const rootPkg = JSON.parse(rootRaw) as { main?: string; exports?: Record<string, unknown> | string; bin?: Record<string, string> };

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

  const exportsMain = typeof rootPkg.exports === 'object' && rootPkg.exports !== null ? (rootPkg.exports as Record<string, Record<string, string>>)['.']?.['import'] : undefined;
  const mainRel =
    rootPkg.main ??
    exportsMain ??
    (() => {
      throw new Error('No main entry point found in package.json (main or exports["."]["import"] required)');
    })();
  const binEntries = Object.entries(rootPkg.bin ?? {});

  // Step 5: Build alias map — redirect each local workspace package name to its
  // TypeScript source so esbuild can inline it without dist/ needing to exist.
  // e.g. "@monorepo/one" → "packages/one/src/module.ts"
  const alias: Record<string, string> = {};
  for (const wPkgPath of workspacePaths) {
    const wRaw = await readFile(wPkgPath, 'utf8');
    const wPkg = JSON.parse(wRaw) as { name?: string; main?: string; exports?: Record<string, unknown> | string };
    if (!wPkg.name) continue;
    const wExportsMain = typeof wPkg.exports === 'object' && wPkg.exports !== null ? (wPkg.exports as Record<string, Record<string, string>>)['.']?.['import'] : undefined;
    const wMainRel = wPkg.main ?? wExportsMain;
    if (!wMainRel) continue;
    alias[wPkg.name] = path.join(path.dirname(wPkgPath), toTsSrc(wMainRel));
  }

  // Step 6: Derive entryPoints from dist paths declared in package.json.
  // e.g. "./dist/module.js" → in: "src/module.ts", out: "module"
  // e.g. "./dist/bin/hello.js" → in: "src/bin/hello.ts", out: "bin/hello"
  const entryPoints: Array<{ in: string; out: string }> = [
    { in: path.join(opts.rootDir, toTsSrc(mainRel)), out: toOutName(mainRel) },
    ...binEntries.map(([, binRelPath]) => ({
      in: path.join(opts.rootDir, toTsSrc(binRelPath)),
      out: toOutName(binRelPath),
    })),
  ];

  // Step 7: Run esbuild — all entries in one call with code splitting.
  logEsbuild(entryPoints, opts.rootDir);
  const esbuildOptions: BuildOptions = {
    entryPoints,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['esnext'],
    alias,
    external: [...externalSet],
    treeShaking: true,
    splitting: true,
    outdir: path.join(opts.rootDir, 'dist'),
    write: true,
  };
  // log(`esbuild options: ${JSON.stringify(esbuildOptions, null, 2)}`);
  await build(esbuildOptions);
}
