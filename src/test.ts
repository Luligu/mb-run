/**
 * @file src/test.ts
 * @description This file contains test-runner selection utilities for the mb-run command.
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

import { binExists } from './build.js';
import { fileExists } from './clean.js';
import { runJest } from './jest.js';
import { ExitError } from './spawn.js';
import { runVitest } from './vitest.js';

/** Context shared by all test operations. */
export interface TestOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** True when running on Windows. */
  isWindows: boolean;
  /** When true, log but skip command execution. */
  dryRun: boolean;
  /** When true, enable the runner's verbose output. */
  verbose: boolean;
  /** When true, keep compatible runners in watch mode. */
  watch: boolean;
  /** When true, collect test coverage. */
  coverage: boolean;
}

/**
 * Runs every configured and installed project test runner.
 *
 * Jest runs before Vitest when both are available. A runner requires both its
 * project configuration file and local binary to be eligible.
 *
 * @param {TestOptions} opts Test options.
 * @returns {Promise<void>} Resolves when all eligible test runners complete.
 * @throws {ExitError} When no eligible Jest or Vitest setup is found.
 */
export async function runTests(opts: TestOptions): Promise<void> {
  const [hasJestConfig, hasVitestConfig, hasJestBin, hasVitestBin] = await Promise.all([
    fileExists(path.join(opts.rootDir, 'jest.config.js')),
    fileExists(path.join(opts.rootDir, 'vite.config.ts')),
    binExists('jest', opts),
    binExists('vitest', opts),
  ]);

  const shouldRunJest = hasJestConfig && hasJestBin;
  const shouldRunVitest = hasVitestConfig && hasVitestBin;
  if (!shouldRunJest && !shouldRunVitest) {
    throw new ExitError(1, 'No test runner found: install Jest with jest.config.js or Vitest with vite.config.ts.');
  }

  if (shouldRunJest) await runJest(opts);
  if (shouldRunVitest) await runVitest(opts);
}
