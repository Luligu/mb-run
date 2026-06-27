/**
 * @description This file contains eslint linting utilities for the mb-run command.
 * @file eslint.ts
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

/** Context shared by all eslint operations. */
export interface EsLintOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** True when running on Windows. */
  isWindows: boolean;
  /** When true, log but skip command execution. */
  dryRun: boolean;
  /** When true, apply automatic fixes. */
  fix: boolean;
}

/**
 * Runs eslint on the project using the eslint binary.
 *
 * When `eslint.config.js` is present in `opts.rootDir`, it is used as the lint
 * configuration.  Otherwise, the bundled fallback configuration from
 * `vendor/eslint.config.js` is used.
 *
 * @param {EsLintOptions} opts EsLint options.
 * @returns {Promise<void>} Resolves when linting completes without errors.
 */
export async function runEsLint(opts: EsLintOptions): Promise<void> {
  const projectConfig = path.join(opts.rootDir, 'eslint.config.js');
  let configPath: string;
  if (await fileExists(projectConfig)) {
    configPath = projectConfig;
  } else {
    const selfDir = path.dirname(url.fileURLToPath(import.meta.url));
    configPath = path.join(selfDir, '..', 'vendor', 'eslint.config.js');
  }
  await runBin('eslint', ['--config', configPath, '--cache', '--cache-location', '.cache/.eslintcache', ...(opts.fix ? ['--fix'] : []), '--max-warnings=0', '.'], {
    rootDir: opts.rootDir,
    isWindows: opts.isWindows,
    dryRun: opts.dryRun,
    mode: 'build',
    watch: false,
  });
}
