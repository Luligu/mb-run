/**
 * @file src/install.ts
 * @description This file contains package installation utilities for the mb-run command.
 * @author Luca Liguori
 * @created 2026-07-12
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

import { isPlugin } from './helpers.js';
import { runCommand } from './spawn.js';

/** Context shared by package installation operations. */
export interface InstallOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** When true, log but skip command execution. */
  dryRun: boolean;
}

/**
 * Installs package dependencies and links Matterbridge for plugin projects.
 *
 * @param {InstallOptions} opts Installation options.
 * @returns {Promise<void>} Resolves when installation and optional linking complete.
 */
export async function runInstall(opts: InstallOptions): Promise<void> {
  await runCommand('npm', ['install', '--no-fund', '--no-audit', '--silent'], { cwd: opts.rootDir, dryRun: opts.dryRun });
  if (await isPlugin(opts.rootDir)) {
    await runCommand('npm', ['link', 'matterbridge', '--no-fund', '--no-audit', '--silent'], { cwd: opts.rootDir, dryRun: opts.dryRun });
  }
}
