/**
 * @description This file contains oxlint linting utilities for the mb-run command.
 * @file oxlint.ts
 * @author Luca Liguori
 * @created 2026-05-15
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
import url from 'node:url';

import { runBin } from './build.js';
import { fileExists } from './clean.js';

/** Context shared by all oxlint operations. */
export interface OxLintOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** True when running on Windows. */
  isWindows: boolean;
  /** When true, log but skip command execution. */
  dryRun: boolean;
}

/**
 * Runs oxlint on the project using the oxlint binary.
 *
 * When `.oxlintrc.json` is present in `opts.rootDir`, it is used as the lint
 * configuration.  Otherwise, the bundled fallback configuration from
 * `vendor/upgrade/.oxlintrc.json` is used.
 *
 * @param {OxLintOptions} opts OxLint options.
 * @returns {Promise<void>} Resolves when linting completes without errors.
 */
export async function runOxLint(opts: OxLintOptions): Promise<void> {
  const projectConfig = path.join(opts.rootDir, '.oxlintrc.json');
  let configPath: string;
  if (await fileExists(projectConfig)) {
    configPath = projectConfig;
  } else {
    const selfDir = path.dirname(url.fileURLToPath(import.meta.url));
    configPath = path.join(selfDir, '..', 'vendor', 'upgrade', '.oxlintrc.json');
  }
  await runBin('oxlint', ['-c', configPath, '.'], { rootDir: opts.rootDir, isWindows: opts.isWindows, dryRun: opts.dryRun, mode: 'build', watch: false });
}
