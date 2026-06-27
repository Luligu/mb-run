/**
 * @description This file contains the linter selection utility for the mb-run command.
 * @file lint.ts
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

import { binExists } from './build.js';
import { runEsLint } from './eslint.js';
import { runOxLint } from './oxlint.js';
import { ExitError } from './spawn.js';

/** Context shared by all lint operations. */
export interface LintOptions {
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
 * Lints the project, preferring oxlint and falling back to eslint.
 *
 * Uses oxlint when its binary is installed, otherwise eslint.  Throws an
 * {@link ExitError} when neither linter is available.
 *
 * @param {LintOptions} opts Lint options.
 * @returns {Promise<void>} Resolves when linting completes without errors.
 * @throws {ExitError} When neither oxlint nor eslint is installed.
 */
export async function runLinter(opts: LintOptions): Promise<void> {
  if (await binExists('oxlint', opts)) {
    await runOxLint(opts);
  } else if (await binExists('eslint', opts)) {
    await runEsLint(opts);
  } else {
    throw new ExitError(1, 'No linter found in node_modules: install oxlint or eslint.');
  }
}
