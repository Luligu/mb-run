/**
 * @file src/vitest.ts
 * @description This file contains Vitest test-runner utilities for the mb-run command.
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

import { runBin } from './build.js';

/** Context shared by all Vitest operations. */
export interface VitestOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** True when running on Windows. */
  isWindows: boolean;
  /** When true, log but skip command execution. */
  dryRun: boolean;
  /** When true, enable Vitest's verbose reporter. */
  verbose: boolean;
  /** When true, keep Vitest running in watch mode. */
  watch: boolean;
  /** When true, collect test coverage. */
  coverage: boolean;
}

/**
 * Runs Vitest once using its project configuration.
 *
 * @param {VitestOptions} opts Vitest options.
 * @returns {Promise<void>} Resolves when Vitest completes without errors.
 */
export async function runVitest(opts: VitestOptions): Promise<void> {
  const args = [opts.watch ? 'watch' : 'run'];
  if (opts.verbose) args.push('--reporter', 'verbose');
  if (opts.coverage) args.push('--coverage');
  await runBin('vitest', args, { ...opts, mode: 'build', watch: false });
}
