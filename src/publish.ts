/**
 * @description This file contains publish utilities for the mb-run command.
 * @file publish.ts
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
import { isPlugin } from './helpers.js';
import { logDelete, logWriteFile } from './logger.js';
import { runCommand } from './spawn.js';
import { updateRootVersion, updateWorkspaceDependencyVersions } from './version.js';

/** Context shared by all publish operations. */
export interface PublishOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** True when running on Windows. */
  isWindows: boolean;
  /** When true, log but skip command execution and file-system writes. */
  dryRun: boolean;
  /** Optional prerelease tag; when set, bumps the version before publishing. */
  tag?: 'dev' | 'edge' | 'git' | 'local' | 'next' | 'alpha' | 'beta' | null;
}

/**
 * Removes a file (silently succeeds if missing).
 *
 * @param {string} filePath File path.
 * @param {PublishOptions} opts Publish options.
 * @returns {Promise<void>} Resolves when removed.
 */
async function removeFile(filePath: string, opts: PublishOptions): Promise<void> {
  logDelete(filePath);
  if (opts.dryRun) return;
  await rm(filePath, { force: true });
}

/**
 * Strips `devDependencies` and `scripts` from a `package.json` file in place.
 *
 * @param {string} pkgPath Absolute path to the package.json file.
 * @param {PublishOptions} opts Publish options.
 * @returns {Promise<void>} Resolves when the file has been written.
 */
async function stripPackageJson(pkgPath: string, opts: PublishOptions): Promise<void> {
  logWriteFile(pkgPath);
  if (opts.dryRun) return;
  const raw = await readFile(pkgPath, 'utf8');
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  delete pkg['devDependencies'];
  delete pkg['scripts'];
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

/**
 * Performs the npm-publish workflow for the root package and all workspace packages.
 *
 * Steps performed in order:
 * 1. Back up `package.json` (and tsconfig files) into memory
 * 1b. If `opts.tag` is set, bump the version via `updateRootVersion` + `updateWorkspaceDependencyVersions` + `npm install --package-lock-only`
 * 2. Strip `devDependencies` and `scripts` from the root `package.json`
 * 3. Strip `devDependencies` and `scripts` from each workspace `package.json`
 * 4. Clean build artifacts
 * 5. Build for production
 * 6. Empty `node_modules` and delete lock files for root and all workspaces
 * 7. `npm install --omit=dev` and `npm shrinkwrap --omit=dev` (root)
 * 8. `npm publish` for each workspace then root
 * 9. Restore all `package.json` files from memory (always, even on error); delete all lock files; `npm install`
 * 10. Build the workspace
 * 11. Format the workspace
 *
 * @param {PublishOptions} opts Publish options.
 * @returns {Promise<void>} Resolves when the full publish workflow completes.
 */
export async function runPublish(opts: PublishOptions): Promise<void> {
  const rootPkgPath = path.join(opts.rootDir, 'package.json');
  const workspacePkgPaths = await resolveWorkspacePackageJsonPaths(opts.rootDir);

  // Step 1: Back up package.json files into memory.
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
    // Step 2: Strip devDependencies and scripts from root package.json.
    await stripPackageJson(rootPkgPath, opts);

    // Step 3: Strip devDependencies and scripts from each workspace package.json.
    for (const wPkgPath of workspacePkgPaths) {
      await stripPackageJson(wPkgPath, opts);
    }

    // Step 4: Clean build artifacts.
    await cleanOnly({ rootDir: opts.rootDir, dryRun: opts.dryRun });

    // Step 5: Build for production.
    await runWorkspaceBuild({ rootDir: opts.rootDir, isWindows: opts.isWindows, dryRun: opts.dryRun, mode: 'production', watch: false });

    // Step 6: Empty node_modules and delete lock files for root and all workspaces.
    await emptyDir(path.join(opts.rootDir, 'node_modules'), opts);
    await removeFile(path.join(opts.rootDir, 'package-lock.json'), opts);
    await removeFile(path.join(opts.rootDir, 'npm-shrinkwrap.json'), opts);
    for (const wPkgPath of workspacePkgPaths) {
      const wDir = path.dirname(wPkgPath);
      await emptyDir(path.join(wDir, 'node_modules'), opts);
      await removeFile(path.join(wDir, 'package-lock.json'), opts);
      await removeFile(path.join(wDir, 'npm-shrinkwrap.json'), opts);
    }

    // Step 7: npm install --omit=dev and npm shrinkwrap --omit=dev (root).
    await runCommand('npm', ['install', '--omit=dev', '--no-fund', '--no-audit', '--silent'], { cwd: opts.rootDir, dryRun: opts.dryRun });
    await runCommand('npm', ['shrinkwrap', '--omit=dev', '--silent'], { cwd: opts.rootDir, dryRun: opts.dryRun });

    // Step 8: npm publish for each workspace then root.
    for (const wPkgPath of workspacePkgPaths) {
      const wDir = path.dirname(wPkgPath);
      const publishArgs = opts.tag != null ? ['publish', '--tag', opts.tag] : ['publish'];
      await runCommand('npm', publishArgs, { cwd: wDir, dryRun: opts.dryRun });
    }
    const rootPublishArgs = opts.tag != null ? ['publish', '--tag', opts.tag] : ['publish'];
    await runCommand('npm', rootPublishArgs, { cwd: opts.rootDir, dryRun: opts.dryRun });
  } finally {
    // Step 9: Restore all package.json files from memory (always, even on error).
    if (!opts.dryRun) {
      await restore(opts.rootDir);
    }

    // Step 9 (continued): Delete all lock files and run full npm install.
    await removeFile(path.join(opts.rootDir, 'package-lock.json'), opts);
    await removeFile(path.join(opts.rootDir, 'npm-shrinkwrap.json'), opts);
    for (const wPkgPath of workspacePkgPaths) {
      const wDir = path.dirname(wPkgPath);
      await removeFile(path.join(wDir, 'package-lock.json'), opts);
      await removeFile(path.join(wDir, 'npm-shrinkwrap.json'), opts);
    }
    await runCommand('npm', ['install', '--no-fund', '--no-audit', '--silent'], { cwd: opts.rootDir, dryRun: opts.dryRun });
    if (await isPlugin(opts.rootDir)) await runCommand('npm', ['link', 'matterbridge', '--no-fund', '--no-audit', '--silent'], { cwd: opts.rootDir, dryRun: opts.dryRun });

    // Step 10: Build the workspace.
    await runWorkspaceBuild({ rootDir: opts.rootDir, isWindows: opts.isWindows, dryRun: opts.dryRun, mode: 'build', watch: false });

    // Step 11: Format the workspace.
    await runBin('prettier', ['--log-level=silent', '--cache', '--cache-location', '.cache/.prettiercache', '--write', '.'], {
      rootDir: opts.rootDir,
      isWindows: opts.isWindows,
      dryRun: opts.dryRun,
      mode: 'build',
      watch: false,
    });
  }
}
