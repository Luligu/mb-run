/**
 * @description This file contains prettier formatting utilities for the mb-run command.
 * @file prettier.ts
 * @author Luca Liguori
 * @created 2026-06-23
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

/** Context shared by all prettier operations. */
export interface PrettierOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** True when running on Windows. */
  isWindows: boolean;
  /** When true, log but skip command execution. */
  dryRun: boolean;
  /** When true, only check formatting instead of writing changes. */
  check: boolean;
}

/**
 * Runs prettier on the project using the prettier binary.
 *
 * When `prettier.config.js` is present in `opts.rootDir`, it is used as the
 * format configuration.  Otherwise, the bundled fallback configuration from
 * `vendor/prettier.config.js` is used.
 *
 * @param {PrettierOptions} opts Prettier options.
 * @returns {Promise<void>} Resolves when formatting completes without errors.
 */
export async function runPrettier(opts: PrettierOptions): Promise<void> {
  const projectConfig = path.join(opts.rootDir, 'prettier.config.js');
  let configPath: string;
  if (await fileExists(projectConfig)) {
    configPath = projectConfig;
  } else {
    const selfDir = path.dirname(url.fileURLToPath(import.meta.url));
    configPath = path.join(selfDir, '..', 'vendor', 'prettier.config.js');
  }
  await runBin('prettier', ['--config', configPath, '--log-level=silent', '--cache', '--cache-location', '.cache/.prettiercache', opts.check ? '--check' : '--write', '.'], {
    rootDir: opts.rootDir,
    isWindows: opts.isWindows,
    dryRun: opts.dryRun,
    mode: 'build',
    watch: false,
  });
}
