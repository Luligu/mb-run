/**
 * @file src/format.ts
 * @description This file contains the formatter selection utility for the mb-run command.
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
import { runOxFormat } from './oxfmt.js';
import { runPrettier } from './prettier.js';
import { ExitError } from './spawn.js';

/** Context shared by all format operations. */
export interface FormatOptions {
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
 * Formats the project, preferring oxfmt and falling back to prettier.
 *
 * Uses oxfmt when its binary is installed, otherwise prettier.  Throws an
 * {@link ExitError} when neither formatter is available.
 *
 * @param {FormatOptions} opts Format options.
 * @returns {Promise<void>} Resolves when formatting completes without errors.
 * @throws {ExitError} When neither oxfmt nor prettier is installed.
 */
export async function runFormatter(opts: FormatOptions): Promise<void> {
  if (await binExists('oxfmt', opts)) {
    await runOxFormat(opts);
  } else if (await binExists('prettier', opts)) {
    await runPrettier(opts);
  } else {
    throw new ExitError(1, 'No formatter found in node_modules: install oxfmt or prettier.');
  }
}
