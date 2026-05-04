/**
 * @description This file contains dependency update utilities for the mb-run command.
 * @file update.ts
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

import { run as ncuRun } from 'npm-check-updates';

/** Context shared by all update operations. */
export interface UpdateOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** True when running on Windows. */
  isWindows: boolean;
  /** When true, log but skip command execution and file-system writes. */
  dryRun: boolean;
}

/**
 * Upgrades all dependencies in place using npm-check-updates.
 *
 * For workspace monorepos (package.json has a `workspaces` field) the update
 * covers the root and every workspace package in one call.  For plain packages
 * only the root package.json is updated.
 *
 * @param {UpdateOptions} opts Update options.
 * @returns {Promise<void>} Resolves when all package.json files have been upgraded.
 */
export async function runUpdate(opts: UpdateOptions): Promise<void> {
  if (opts.dryRun) return;

  const raw = await readFile(path.join(opts.rootDir, 'package.json'), 'utf8');
  const rootPkg = JSON.parse(raw) as { workspaces?: unknown };
  const isWorkspace = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces.length > 0 : false;

  if (isWorkspace) {
    await ncuRun({ upgrade: true, workspaces: true, root: true, silent: true, cwd: opts.rootDir });
  } else {
    await ncuRun({ upgrade: true, silent: true, cwd: opts.rootDir });
  }
}
