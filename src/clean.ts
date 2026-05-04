/**
 * @description This file contains file-system clean utilities for the mb-run command.
 * @file clean.ts
 * @author Luca Liguori
 * @created 2026-05-01
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

import { access, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { logDelete } from './logger.js';

/** Context shared by all clean operations. */
export interface CleanOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** When true, log but skip file-system writes. */
  dryRun: boolean;
}

/**
 * Checks if a file path exists.
 *
 * @param {string} filePath File path.
 * @returns {Promise<boolean>} True if exists.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes a path if it exists.
 *
 * @param {string} targetPath Path to remove.
 * @param {CleanOptions} opts Clean options.
 * @returns {Promise<void>} Resolves when removed.
 */
async function removePath(targetPath: string, opts: CleanOptions): Promise<void> {
  logDelete(targetPath);
  if (opts.dryRun) return;
  await rm(targetPath, { recursive: true, force: true });
}

/**
 * Empties a directory without removing it (devcontainer volume friendly).
 *
 * @param {string} dirPath Directory path.
 * @param {CleanOptions} opts Clean options.
 * @returns {Promise<void>} Resolves when emptied.
 */
export async function emptyDir(dirPath: string, opts: CleanOptions): Promise<void> {
  if (!(await fileExists(dirPath))) return;
  const entries = await readdir(dirPath, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      await removePath(path.join(dirPath, entry.name), opts);
    }),
  );
}

/**
 * Empties a directory only if it exists; does not create it.
 *
 * @param {string} dirPath Directory path.
 * @param {CleanOptions} opts Clean options.
 * @returns {Promise<void>} Resolves when emptied or when missing.
 */
async function emptyDirIfExists(dirPath: string, opts: CleanOptions): Promise<void> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      await removePath(path.join(dirPath, entry.name), opts);
    }),
  );
}

/**
 * Removes all `.tsbuildinfo` files under a root, skipping node_modules.
 *
 * @param {string} rootDir Root directory.
 * @param {CleanOptions} opts Clean options.
 * @returns {Promise<void>} Resolves when done.
 */
async function removeTsBuildInfo(rootDir: string, opts: CleanOptions): Promise<void> {
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      // Missing directory or unreadable; ignore.
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        stack.push(path.join(current, entry.name));
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.tsbuildinfo')) {
        await removePath(path.join(current, entry.name), opts);
      }
    }
  }
}

/**
 * Removes common build/test artifacts from workspace folders.
 *
 * @param {string} parentDir Parent directory that contains workspaces.
 * @param {boolean} ensureDirs Whether to ensure workspace dirs exist after emptying.
 * @param {CleanOptions} opts Clean options.
 * @returns {Promise<void>} Resolves when done.
 */
async function cleanWorkspaceArtifacts(parentDir: string, ensureDirs: boolean, opts: CleanOptions): Promise<void> {
  let workspaces;
  try {
    workspaces = await readdir(parentDir, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    workspaces
      .filter((d) => d.isDirectory())
      .map(async (d) => {
        const wsRoot = path.join(parentDir, d.name);
        await Promise.all([
          removePath(path.join(wsRoot, 'build'), opts),
          removePath(path.join(wsRoot, 'dist'), opts),
          removePath(path.join(wsRoot, 'dist-jest'), opts),
          removePath(path.join(wsRoot, 'coverage'), opts),
          removePath(path.join(wsRoot, 'jest'), opts),
          removePath(path.join(wsRoot, 'temp'), opts),
          removePath(path.join(wsRoot, '.cache'), opts),
          removePath(path.join(wsRoot, 'node_modules'), opts),
          removePath(path.join(wsRoot, 'package-lock.json'), opts),
          removePath(path.join(wsRoot, 'npm-shrinkwrap.json'), opts),
        ]);

        const empty = ensureDirs ? emptyDir : emptyDirIfExists;
        await Promise.all([empty(path.join(wsRoot, '.cache'), opts), empty(path.join(wsRoot, 'node_modules'), opts)]);
      }),
  );
}

/**
 * Shared clean pipeline for both --clean and --reset.
 *
 * @param {boolean} emptyRootNodeModules Whether to empty root node_modules.
 * @param {boolean} ensureWorkspaceDirs Whether to ensure workspace dirs exist after emptying.
 * @param {CleanOptions} opts Clean options.
 * @returns {Promise<void>} Resolves when done.
 */
async function commonClean(emptyRootNodeModules: boolean, ensureWorkspaceDirs: boolean, opts: CleanOptions): Promise<void> {
  await removeTsBuildInfo(opts.rootDir, opts);

  await Promise.all([
    removePath(path.join(opts.rootDir, 'build'), opts),
    removePath(path.join(opts.rootDir, 'dist'), opts),
    removePath(path.join(opts.rootDir, 'dist-jest'), opts),
    removePath(path.join(opts.rootDir, 'coverage'), opts),
    removePath(path.join(opts.rootDir, 'jest'), opts),
    removePath(path.join(opts.rootDir, 'temp'), opts),
    removePath(path.join(opts.rootDir, 'npm-shrinkwrap.json'), opts),
  ]);

  await Promise.all([
    cleanWorkspaceArtifacts(path.join(opts.rootDir, 'packages'), ensureWorkspaceDirs, opts),
    cleanWorkspaceArtifacts(path.join(opts.rootDir, 'apps'), ensureWorkspaceDirs, opts),
  ]);

  // Always empty root .cache (don't create it on clean).
  const emptyRootCache = ensureWorkspaceDirs ? emptyDir : emptyDirIfExists;
  await emptyRootCache(path.join(opts.rootDir, '.cache'), opts);

  if (emptyRootNodeModules) {
    await emptyDir(path.join(opts.rootDir, 'node_modules'), opts);
  }
}

/**
 * Performs a reset-style clean without relying on node_modules tools.
 *
 * @param {CleanOptions} opts Clean options.
 * @returns {Promise<void>} Resolves when done.
 */
export async function resetClean(opts: CleanOptions): Promise<void> {
  await commonClean(true, false, opts);
}

/**
 * Clean artifacts (like package.json clean) without reinstalling.
 *
 * @param {CleanOptions} opts Clean options.
 * @returns {Promise<void>} Resolves when done.
 */
export async function cleanOnly(opts: CleanOptions): Promise<void> {
  await commonClean(false, false, opts);
}
