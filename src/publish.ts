/**
 * @file src/publish.ts
 * @description This file contains publish utilities for the mb-run command.
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
import { runFormatter } from './format.js';
import { isLibrary, removeFile } from './helpers.js';
import { logWriteFile } from './logger.js';
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
 * Strips development metadata from a `package.json` file in place.
 *
 * @param {string} pkgPath Absolute path to the package.json file.
 * @param {PublishOptions} opts Publish options.
 * @param {boolean} [removeWorkspaces] When true, also removes the root workspaces field.
 * @returns {Promise<void>} Resolves when the file has been written.
 */
async function stripPackageJson(pkgPath: string, opts: PublishOptions, removeWorkspaces: boolean = false): Promise<void> {
  logWriteFile(pkgPath);
  if (opts.dryRun) return;
  const raw = await readFile(pkgPath, 'utf8');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  delete pkg['devDependencies'];
  delete pkg['scripts'];
  if (removeWorkspaces) delete pkg['workspaces'];
  if (!(await isLibrary(path.dirname(pkgPath)))) {
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
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

/**
 * Performs the npm-publish workflow for the root package and all workspace packages.
 *
 * Steps performed in order:
 * 1. Back up `package.json`, tsconfig files, and lockfiles into memory
 * 2. If `opts.tag` is set, bump the version via `updateRootVersion` + `updateWorkspaceDependencyVersions` + `npm install --package-lock-only`
 * 3. Strip `devDependencies`, `scripts`, and `workspaces` from the root `package.json`
 * 4. Strip `devDependencies` and `scripts` from each workspace `package.json`
 * 5. Clean build artifacts
 * 6. Build for production
 * 7. Delete lock files for root and all workspaces
 * 8. Generate a production-only root shrinkwrap without modifying `node_modules`
 * 9. `npm publish` for each workspace then root
 * 10. Restore all `package.json` files and lockfiles from memory (always, even on error)
 * 11. Format the workspace
 * 12. Build the workspace
 *
 * @param {PublishOptions} opts Publish options.
 * @returns {Promise<void>} Resolves when the full publish workflow completes.
 */
export async function runPublish(opts: PublishOptions): Promise<void> {
  const rootPkgPath = path.join(opts.rootDir, 'package.json');
  const workspacePkgPaths = await resolveWorkspacePackageJsonPaths(opts.rootDir);
  const lockfilePaths = [
    path.join(opts.rootDir, 'package-lock.json'),
    path.join(opts.rootDir, 'npm-shrinkwrap.json'),
    ...workspacePkgPaths.flatMap((workspacePkgPath) => {
      const workspaceDir = path.dirname(workspacePkgPath);
      return [path.join(workspaceDir, 'package-lock.json'), path.join(workspaceDir, 'npm-shrinkwrap.json')];
    }),
  ];
  const lockfileContents = new Map<string, Buffer>();

  // Step 1: Back up package.json files and lockfiles into memory.
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

    // Step 3: Strip development and workspace metadata from root package.json.
    await stripPackageJson(rootPkgPath, opts, true);

    // Step 4: Strip devDependencies and scripts from each workspace package.json.
    for (const wPkgPath of workspacePkgPaths) {
      await stripPackageJson(wPkgPath, opts);
    }

    // Step 5: Clean build artifacts.
    await cleanOnly({ rootDir: opts.rootDir, dryRun: opts.dryRun });

    // Step 6: Build for production.
    await runWorkspaceBuild({
      rootDir: opts.rootDir,
      isWindows: opts.isWindows,
      dryRun: opts.dryRun,
      mode: 'production',
      watch: false,
    });

    // Step 7: Delete lock files for root and all workspaces.
    for (const lockfilePath of lockfilePaths) await removeFile(lockfilePath, opts);

    // Step 8: Generate a production shrinkwrap without changing node_modules.
    await runCommand('npm', ['install', '--package-lock-only', '--omit=dev', '--no-fund', '--no-audit', '--silent'], { cwd: opts.rootDir, dryRun: opts.dryRun });
    await runCommand('npm', ['shrinkwrap', '--omit=dev', '--silent'], {
      cwd: opts.rootDir,
      dryRun: opts.dryRun,
    });

    // Step 9: npm publish for each workspace then root.
    for (const wPkgPath of workspacePkgPaths) {
      const wDir = path.dirname(wPkgPath);
      // oxlint-disable-next-line unicorn/no-negated-condition no-eq-null
      const publishArgs = opts.tag != null ? ['publish', '--tag', opts.tag] : ['publish'];
      await runCommand('npm', publishArgs, { cwd: wDir, dryRun: opts.dryRun });
    }
    // oxlint-disable-next-line unicorn/no-negated-condition no-eq-null
    const rootPublishArgs = opts.tag != null ? ['publish', '--tag', opts.tag] : ['publish'];
    await runCommand('npm', rootPublishArgs, {
      cwd: opts.rootDir,
      dryRun: opts.dryRun,
    });
  } finally {
    // Step 10: Restore all package.json files from memory (always, even on error).
    if (!opts.dryRun) {
      await restore(opts.rootDir);
    }

    // Step 10 (continued): Restore original lockfiles without modifying node_modules.
    for (const lockfilePath of lockfilePaths) {
      const lockfileContent = lockfileContents.get(lockfilePath);
      if (lockfileContent) {
        logWriteFile(lockfilePath);
        await writeFile(lockfilePath, lockfileContent);
      } else {
        await removeFile(lockfilePath, opts);
      }
    }

    // Step 11: Format the workspace.
    await runFormatter({ ...opts, check: false });

    // Step 12: Build the workspace.
    await runWorkspaceBuild({
      rootDir: opts.rootDir,
      isWindows: opts.isWindows,
      dryRun: opts.dryRun,
      mode: 'build',
      watch: false,
    });
  }
}
