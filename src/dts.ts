/**
 * @file src/dts.ts
 * @description This file contains declaration-bundling utilities for packed libraries.
 * @author Luca Liguori
 * @created 2026-06-24
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

import { runBin } from './build.js';
import { isMonorepo } from './helpers.js';

/** Context shared by declaration-bundling operations. */
export interface DtsOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** True when running on Windows. */
  isWindows: boolean;
  /** When true, log but skip command execution and file-system writes. */
  dryRun: boolean;
}

/**
 * Rebuilds declaration files for library packages.
 *
 * TypeScript 7 does not currently expose the API used by declaration bundlers, so this step
 * reruns TypeScript in declaration-only mode after JavaScript bundling.
 *
 * @param {DtsOptions} opts Declaration build options.
 * @returns {Promise<void>} Resolves when declaration emit completes.
 */
export async function runDtsBuild(opts: DtsOptions): Promise<void> {
  const tsconfigPath = path.join(opts.rootDir, 'tsconfig.build.json');
  const args = (await isMonorepo(opts.rootDir))
    ? ['--build', tsconfigPath, '--incremental', 'true', '--composite', 'true', '--declaration', '--declarationMap', 'false', '--emitDeclarationOnly']
    : ['--project', tsconfigPath, '--incremental', 'false', '--composite', 'false', '--declaration', '--declarationMap', 'false', '--emitDeclarationOnly'];

  await runBin('tsc', args, { rootDir: opts.rootDir, isWindows: opts.isWindows, dryRun: opts.dryRun, mode: 'build', watch: false });
}
