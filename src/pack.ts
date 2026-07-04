/**
 * @file src/pack.ts
 * @description This file contains pack utilities for the mb-run command.
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

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runWorkspaceBuild } from './build.js';
import { backup, resolveWorkspacePackageJsonPaths, restore } from './cache.js';
import { cleanOnly, fileExists } from './clean.js';
import { runDtsBundle } from './dts.js';
import { runEsbuild } from './esbuild.js';
import { runFormatter } from './format.js';
import { isLibrary, removeFile } from './helpers.js';
import { logWriteFile } from './logger.js';
import { runCommand } from './spawn.js';
import { updateRootVersion, updateWorkspaceDependencyVersions } from './version.js';

/** Context shared by all pack operations. */
export interface PackOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** True when running on Windows. */
  isWindows: boolean;
  /** When true, log but skip command execution and file-system writes. */
  dryRun: boolean;
  /** When true, print verbose command diagnostics. */
  verbose?: boolean;
  /** Optional prerelease tag; when set, bumps the version before packing. */
  tag?: 'dev' | 'edge' | 'git' | 'local' | 'next' | 'alpha' | 'beta' | null;
  /** When true, minify the generated bundle. */
  minify?: boolean;
}

/**
 * Performs the full npm-pack workflow: back up, prepare, pack, then restore.
 *
 * Steps performed in order:
 * 1. Back up `package.json`, tsconfig files, and lockfiles into memory
 * 2. If `opts.tag` is set, bump the version via `updateRootVersion` + `updateWorkspaceDependencyVersions` + `npm install --package-lock-only`
 * 3. Clean build artifacts
 * 4. Build the workspace for production
 * 5. Bundle with esbuild
 * 6. Bundle declarations for library packages
 * 7. Strip `devDependencies` and `scripts` from `package.json`; redirect bundled binary launchers to `dist/bin`; remove type metadata for non-library packages
 * 8. Merge all `dependencies` from workspace packages into the root `dependencies`
 *     so the generated shrinkwrap records every runtime dependency needed by bundled code;
 *     strip local workspace package names from `dependencies` and remove `workspaces`
 * 9. Delete `package-lock.json` and `npm-shrinkwrap.json`
 * 10. Generate a production-only `package-lock.json` without modifying `node_modules`
 * 11. Convert the lockfile to `npm-shrinkwrap.json`
 * 12. `npm pack`
 * 13. Restore all files from memory (always, even on error)
 * 14. Restore the original lockfiles
 * 15. Format the workspace
 * 16. Build the workspace
 *
 * @param {PackOptions} opts Pack options.
 * @returns {Promise<void>} Resolves when the full pack workflow completes.
 */
export async function runPack(opts: PackOptions): Promise<void> {
  const packageJsonPath = path.join(opts.rootDir, 'package.json');
  const lockfilePaths = [path.join(opts.rootDir, 'package-lock.json'), path.join(opts.rootDir, 'npm-shrinkwrap.json')];
  const lockfileContents = new Map<string, Buffer>();

  // Step 1: Back up package.json, tsconfig files, and lockfiles into memory.
  if (!opts.dryRun) {
    await backup(opts.rootDir);
    for (const lockfilePath of lockfilePaths) {
      if (await fileExists(lockfilePath)) lockfileContents.set(lockfilePath, await readFile(lockfilePath));
    }
  }

  try {
    // Step 2: Bump version (if tag provided) — must be after backup so restore works.
    // oxlint-disable-next-line no-eq-null
    if (opts.tag != null) {
      const versionOpts = { rootDir: opts.rootDir, dryRun: opts.dryRun };
      const nextVersion = await updateRootVersion(opts.tag, versionOpts);
      await updateWorkspaceDependencyVersions(nextVersion, versionOpts);
      await runCommand('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', '--silent'], {
        cwd: opts.rootDir,
        dryRun: opts.dryRun,
      });
    }

    // Step 3: Clean build artifacts.
    await cleanOnly({ rootDir: opts.rootDir, dryRun: opts.dryRun });

    // Step 4: Build for production.
    await runWorkspaceBuild({
      rootDir: opts.rootDir,
      isWindows: opts.isWindows,
      dryRun: opts.dryRun,
      mode: 'production',
      watch: false,
    });

    // Step 5: Bundle with esbuild.
    await runEsbuild({
      rootDir: opts.rootDir,
      isWindows: opts.isWindows,
      dryRun: opts.dryRun,
      verbose: opts.verbose,
      minify: opts.minify,
    });

    // Step 6: Inline workspace declarations for packages that publish types.
    if (await isLibrary(opts.rootDir)) {
      await runDtsBundle({ rootDir: opts.rootDir, dryRun: opts.dryRun });
    }

    const workspacePkgPaths = await resolveWorkspacePackageJsonPaths(opts.rootDir);

    // Step 7: Strip development metadata, redirect binary launchers, and strip non-library type metadata from package.json.
    logWriteFile(packageJsonPath);
    if (!opts.dryRun) {
      const raw = await readFile(packageJsonPath, 'utf8');
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      delete pkg['devDependencies'];
      delete pkg['scripts'];
      const packageBin = pkg['bin'];
      if (typeof packageBin === 'object' && packageBin !== null && !Array.isArray(packageBin)) {
        // `runEsbuild` bundles JavaScript launchers into dist/bin. Point npm at
        // those outputs so packed monorepos do not retain workspace-only imports.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const packageBinEntries = packageBin as Record<string, unknown>;
        for (const [binName, binPath] of Object.entries(packageBinEntries)) {
          if (typeof binPath !== 'string' || binPath.startsWith('dist/')) continue;
          if (await fileExists(path.join(opts.rootDir, binPath))) {
            packageBinEntries[binName] = `dist/${binPath.replace(/^\.\//, '')}`;
          }
        }
      }
      if (!(await isLibrary(opts.rootDir))) {
        delete pkg['types'];
        const packageExports = pkg['exports'];
        if (typeof packageExports === 'object' && packageExports !== null && !Array.isArray(packageExports)) {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          const rootExport = (packageExports as Record<string, unknown>)['.'];
          if (typeof rootExport === 'object' && rootExport !== null && !Array.isArray(rootExport)) {
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            delete (rootExport as Record<string, unknown>)['types'];
          }
        }
      }
      await writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    }

    // Step 8: Merge all dependencies from workspace packages into the root dependencies.
    // esbuild inlines workspace code but their runtime deps must still be installed.
    if (!opts.dryRun && workspacePkgPaths.length > 0) {
      const raw = await readFile(packageJsonPath, 'utf8');
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const rootDeps = (pkg['dependencies'] ?? {}) as Record<string, string>;
      for (const wPkgPath of workspacePkgPaths) {
        const wRaw = await readFile(wPkgPath, 'utf8');
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const wPkg = JSON.parse(wRaw) as {
          name?: string;
          dependencies?: Record<string, string>;
        };
        for (const [dep, ver] of Object.entries(wPkg.dependencies ?? {})) {
          if (!(dep in rootDeps)) rootDeps[dep] = ver;
        }
      }
      // Remove local workspace package names from dependencies — they are inlined
      // by esbuild and must not be fetched from the registry.
      for (const wPkgPath of workspacePkgPaths) {
        const wNameRaw = await readFile(wPkgPath, 'utf8');
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const wNamePkg = JSON.parse(wNameRaw) as { name?: string };
        if (wNamePkg.name) {
          // oxlint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete rootDeps[wNamePkg.name];
        }
      }
      pkg['dependencies'] = rootDeps;
      // Remove workspaces field so npm doesn't try to resolve local packages.
      delete pkg['workspaces'];
      logWriteFile(packageJsonPath);
      await writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    }

    // Step 9: Delete package-lock.json and npm-shrinkwrap.json.
    for (const lockfilePath of lockfilePaths) await removeFile(lockfilePath, opts);

    // Step 10: Generate a production lockfile without changing node_modules.
    await runCommand('npm', ['install', '--package-lock-only', '--omit=dev', '--no-fund', '--no-audit', '--silent'], { cwd: opts.rootDir, dryRun: opts.dryRun });

    // Step 11: Convert package-lock.json to npm-shrinkwrap.json.
    await runCommand('npm', ['shrinkwrap', '--omit=dev', '--silent'], {
      cwd: opts.rootDir,
      dryRun: opts.dryRun,
    });

    // Step 12: npm pack.
    await runCommand('npm', ['pack'], {
      cwd: opts.rootDir,
      dryRun: opts.dryRun,
    });
  } finally {
    // Step 13: Restore package.json (and tsconfig files) from memory (always, even on error).
    logWriteFile(packageJsonPath);
    if (!opts.dryRun) {
      await restore(opts.rootDir);
    }

    // Step 14: Restore the original lockfiles without modifying node_modules.
    for (const lockfilePath of lockfilePaths) {
      const lockfileContent = lockfileContents.get(lockfilePath);
      if (lockfileContent) {
        logWriteFile(lockfilePath);
        await writeFile(lockfilePath, lockfileContent);
      } else {
        await removeFile(lockfilePath, opts);
      }
    }

    // Step 15: Format the workspace.
    await runFormatter({ ...opts, check: false });

    // Step 16: Build the workspace.
    await runWorkspaceBuild({
      rootDir: opts.rootDir,
      isWindows: opts.isWindows,
      dryRun: opts.dryRun,
      mode: 'build',
      watch: false,
    });
  }
}
