/**
 * @description This file contains pack utilities for the mb-run command.
 * @file pack.ts
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

import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runBin, runWorkspaceBuild } from './build.js';
import { backup, resolveWorkspacePackageJsonPaths, restore } from './cache.js';
import { cleanOnly, emptyDir } from './clean.js';
import { runEsbuild } from './esbuild.js';
import { isPlugin } from './helpers.js';
import { logDelete, logWriteFile } from './logger.js';
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
  /** Optional prerelease tag; when set, bumps the version before packing. */
  tag?: 'dev' | 'edge' | 'git' | 'local' | 'next' | 'alpha' | 'beta' | null;
}

/**
 * Removes a file (silently succeeds if missing).
 *
 * @param {string} filePath File path.
 * @param {PackOptions} opts Pack options.
 * @returns {Promise<void>} Resolves when removed.
 */
async function removeFile(filePath: string, opts: PackOptions): Promise<void> {
  logDelete(filePath);
  if (opts.dryRun) return;
  await rm(filePath, { force: true });
}

/**
 * Performs the full npm-pack workflow: back up, prepare, pack, then restore.
 *
 * Steps performed in order:
 * 1. Back up `package.json` (and tsconfig files) into memory
 * 1b. If `opts.tag` is set, bump the version via `updateRootVersion` + `updateWorkspaceDependencyVersions` + `npm install --package-lock-only`
 * 2. Clean build artifacts
 * 3. Build the workspace for production
 * 3b. Bundle with esbuild
 * 4. Strip `devDependencies` and `scripts` from `package.json`
 * 4b. Merge all `dependencies` from workspace packages into the root `dependencies`
 *     so `npm install --omit=dev` installs every runtime dep needed by bundled code;
 *     strip local workspace package names from `dependencies` and remove `workspaces`
 * 4b. For monorepos: add `bundleDependencies` to each workspace `package.json`
 * 5. Empty `node_modules`
 * 6. Delete `package-lock.json` and `npm-shrinkwrap.json`
 * 7. `npm install --omit=dev`
 * 8. `npm shrinkwrap --omit=dev`
 * 9. `npm pack`
 * 10. Restore all files from memory (always, even on error) + format
 * 11. Delete `package-lock.json` and `npm-shrinkwrap.json`
 * 12. `npm install` (full restore)
 * 13. Format the workspace
 * 14. Build the workspace
 *
 * @param {PackOptions} opts Pack options.
 * @returns {Promise<void>} Resolves when the full pack workflow completes.
 */
export async function runPack(opts: PackOptions): Promise<void> {
  const packageJsonPath = path.join(opts.rootDir, 'package.json');

  // Step 1: Back up package.json (and tsconfig files) into memory.
  if (!opts.dryRun) {
    await backup(opts.rootDir);
  }

  // Step 1b: Bump version (if tag provided) — must be after backup so restore works.
  if (opts.tag != null) {
    const versionOpts = { rootDir: opts.rootDir, dryRun: opts.dryRun };
    const nextVersion = await updateRootVersion(opts.tag, versionOpts);
    await updateWorkspaceDependencyVersions(nextVersion, versionOpts);
    await runCommand('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', '--silent'], {
      cwd: opts.rootDir,
      dryRun: opts.dryRun,
    });
  }

  try {
    // Step 2: Clean build artifacts.
    await cleanOnly({ rootDir: opts.rootDir, dryRun: opts.dryRun });

    // Step 3: Build for production.
    await runWorkspaceBuild({ rootDir: opts.rootDir, isWindows: opts.isWindows, dryRun: opts.dryRun, mode: 'production', watch: false });

    // Step 3b: Bundle with esbuild.
    await runEsbuild({ rootDir: opts.rootDir, isWindows: opts.isWindows, dryRun: opts.dryRun });

    // Step 4: Strip devDependencies and scripts from package.json.
    logWriteFile(packageJsonPath);
    if (!opts.dryRun) {
      const raw = await readFile(packageJsonPath, 'utf8');
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      delete pkg['devDependencies'];
      delete pkg['scripts'];
      await writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    }

    // Step 4b: Merge all dependencies from workspace packages into the root dependencies.
    // esbuild inlines workspace code but their runtime deps must still be installed.
    const workspacePkgPaths = await resolveWorkspacePackageJsonPaths(opts.rootDir);
    if (!opts.dryRun && workspacePkgPaths.length > 0) {
      const raw = await readFile(packageJsonPath, 'utf8');
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      const rootDeps = (pkg['dependencies'] ?? {}) as Record<string, string>;
      for (const wPkgPath of workspacePkgPaths) {
        const wRaw = await readFile(wPkgPath, 'utf8');
        const wPkg = JSON.parse(wRaw) as { name?: string; dependencies?: Record<string, string> };
        for (const [dep, ver] of Object.entries(wPkg.dependencies ?? {})) {
          if (!(dep in rootDeps)) rootDeps[dep] = ver;
        }
      }
      // Remove local workspace package names from dependencies — they are inlined
      // by esbuild and must not be fetched from the registry.
      for (const wPkgPath of workspacePkgPaths) {
        const wNameRaw = await readFile(wPkgPath, 'utf8');
        const wNamePkg = JSON.parse(wNameRaw) as { name?: string };
        if (wNamePkg.name) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete rootDeps[wNamePkg.name];
        }
      }
      pkg['dependencies'] = rootDeps;
      // Remove workspaces field so npm doesn't try to resolve local packages.
      delete pkg['workspaces'];
      logWriteFile(packageJsonPath);
      await writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    }

    // Step 5: Empty node_modules.
    await emptyDir(path.join(opts.rootDir, 'node_modules'), opts);

    // Step 6: Delete package-lock.json and npm-shrinkwrap.json.
    await removeFile(path.join(opts.rootDir, 'package-lock.json'), opts);
    await removeFile(path.join(opts.rootDir, 'npm-shrinkwrap.json'), opts);

    // Step 7: npm install --omit=dev.
    await runCommand('npm', ['install', '--omit=dev', '--no-fund', '--no-audit', '--silent'], { cwd: opts.rootDir, dryRun: opts.dryRun });

    // Step 8: npm shrinkwrap --omit=dev.
    await runCommand('npm', ['shrinkwrap', '--omit=dev', '--silent'], { cwd: opts.rootDir, dryRun: opts.dryRun });

    // Step 9: npm pack.
    await runCommand('npm', ['pack'], { cwd: opts.rootDir, dryRun: opts.dryRun });
  } finally {
    // Step 10: Restore package.json (and tsconfig files) from memory (always, even on error).
    logWriteFile(packageJsonPath);
    if (!opts.dryRun) {
      await restore(opts.rootDir);
    }
  }

  // Steps 11–13 run only when the pack succeeded (no exception from the try block above).

  // Step 11: npm install (full restore).
  await removeFile(path.join(opts.rootDir, 'package-lock.json'), opts);
  await removeFile(path.join(opts.rootDir, 'npm-shrinkwrap.json'), opts);
  await runCommand('npm', ['install', '--no-fund', '--no-audit', '--silent'], { cwd: opts.rootDir, dryRun: opts.dryRun });
  if (await isPlugin(opts.rootDir)) await runCommand('npm', ['link', 'matterbridge', '--no-fund', '--no-audit', '--silent'], { cwd: opts.rootDir, dryRun: opts.dryRun });

  // Step 12: Format the workspace.
  await runBin('prettier', ['--log-level=silent', '--cache', '--cache-location', '.cache/.prettiercache', '--write', '.'], {
    rootDir: opts.rootDir,
    isWindows: opts.isWindows,
    dryRun: opts.dryRun,
    mode: 'build',
    watch: false,
  });

  // Step 13: Build the workspace.
  await runWorkspaceBuild({ rootDir: opts.rootDir, isWindows: opts.isWindows, dryRun: opts.dryRun, mode: 'build', watch: false });
}
