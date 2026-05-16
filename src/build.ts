/**
 * @description This file contains build and binary-runner utilities for the mb-run command.
 * @file build.ts
 * @author Luca Liguori
 * @created 2026-05-01
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

import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { fileExists } from './clean.js';
import { ExitError, runCommand } from './spawn.js';

const BIN_ENTRYPOINTS: Record<string, [string, string]> = {
  tsc: ['typescript', 'bin/tsc'],
  jest: ['jest', 'bin/jest.js'],
  eslint: ['eslint', 'bin/eslint.js'],
  oxlint: ['oxlint', 'bin/oxlint'],
  prettier: ['prettier', 'bin/prettier.cjs'],
};

/** Context shared by all build and binary-runner operations. */
export interface BuildOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** True when running on Windows. */
  isWindows: boolean;
  /** When true, log but skip command execution. */
  dryRun: boolean;
  /** Build mode — selects the tsconfig variant. */
  mode: 'build' | 'production';
  /** Whether to enable watch mode. */
  watch: boolean;
}

/**
 * Resolves a `node_modules/.bin` shim path.
 *
 * @param {string} binName The executable name.
 * @param {BuildOptions} opts Build options.
 * @returns {string} Absolute path to the shim.
 */
function binPath(binName: string, opts: BuildOptions): string {
  const fileName = opts.isWindows ? `${binName}.cmd` : binName;
  return path.resolve(opts.rootDir, 'node_modules', '.bin', fileName);
}

/**
 * Resolves the underlying Node entrypoint for a known tool.
 *
 * @param {string} binName The tool name.
 * @param {BuildOptions} opts Build options.
 * @returns {string | null} Absolute path to the entrypoint if known.
 */
function entrypointPath(binName: string, opts: BuildOptions): string | null {
  const spec = BIN_ENTRYPOINTS[binName];
  if (!spec) return null;
  const [pkg, rel] = spec;
  return path.resolve(opts.rootDir, 'node_modules', pkg, rel);
}

/**
 * Verifies the tool is installed.
 *
 * @param {string} binName The tool name.
 * @param {BuildOptions} opts Build options.
 * @returns {Promise<void>} Resolves when the tool exists.
 */
async function assertBinExists(binName: string, opts: BuildOptions): Promise<void> {
  const entry = entrypointPath(binName, opts);
  const p = entry ?? binPath(binName, opts);
  try {
    await access(p);
  } catch {
    throw new ExitError(1, `Missing binary: ${p}. Did you run "npm install"?`);
  }
}

/**
 * Picks the best tsconfig path for a workspace for a given build mode.
 *
 * @param {'build' | 'production'} mode Build mode.
 * @param {BuildOptions} opts Build options.
 * @returns {Promise<string>} Absolute path to chosen tsconfig.
 */
async function pickWorkspaceTsconfig(mode: 'build' | 'production', opts: BuildOptions): Promise<string> {
  const candidates = mode === 'production' ? ['tsconfig.build.production.json', 'tsconfig.build.json', 'tsconfig.json'] : ['tsconfig.build.json', 'tsconfig.json'];

  for (const name of candidates) {
    const candidatePath = path.join(opts.rootDir, name);
    if (await fileExists(candidatePath)) {
      // log(`Using ${name} for workspace ${opts.rootDir}...`);
      return candidatePath;
    }
  }
  // Fallback to root tsconfig.json (will error if missing, which is desirable since tsc requires a config).
  return path.join(opts.rootDir, 'tsconfig.json');
}

/**
 * Runs a tool and forwards stdio.
 *
 * @param {string} binName The tool name.
 * @param {string[]} args CLI args.
 * @param {BuildOptions} opts Build options.
 * @param {{ env?: Record<string, string | undefined> }} [runOptions] Per-invocation options.
 * @param {Record<string, string | undefined>} [runOptions.env] Environment overrides.
 * @returns {Promise<void>} Resolves when the tool exits successfully.
 */
export async function runBin(binName: string, args: string[], opts: BuildOptions, runOptions: { env?: Record<string, string | undefined> } = {}): Promise<void> {
  if (!opts.dryRun) await assertBinExists(binName, opts);
  const entry = entrypointPath(binName, opts);
  if (entry) {
    await runCommand(process.execPath, [entry, ...args], { env: runOptions.env, dryRun: opts.dryRun, label: binName, displayArgs: args });
  } else {
    await runCommand(binPath(binName, opts), args, { env: runOptions.env, dryRun: opts.dryRun, label: binName });
  }
}

/**
 * Runs tsc in build mode, selecting per-workspace tsconfig files when available.
 *
 * @param {BuildOptions} options Build and context options.
 * @param {'build' | 'production'} options.mode Build mode.
 * @param {boolean} options.watch Whether to enable watch mode.
 * @param {string} options.rootDir Root directory of the project.
 * @param {boolean} options.isWindows True when running on Windows.
 * @param {boolean} options.dryRun When true, log but skip command execution.
 * @returns {Promise<void>} Resolves when build completes.
 */
export async function runWorkspaceBuild(options: BuildOptions): Promise<void> {
  const configs = await pickWorkspaceTsconfig(options.mode, options);
  const args = ['-b', configs, '--pretty', 'false'];
  if (options.watch) args.push('--watch');
  await runBin('tsc', args, options);
}
