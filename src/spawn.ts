/**
 * @description This file contains spawn utilities for running external commands.
 * @file spawn.ts
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

import process from 'node:process';

import spawn from 'cross-spawn';

import { logCommand } from './logger.js';

/**
 * An Error subtype that carries a desired process exit code.
 */
export class ExitError extends Error {
  code: number;

  /**
   * @param {number} code The desired exit code.
   * @param {string} message The error message.
   */
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Runs an external command and forwards stdio.
 *
 * @param {string} command The executable to run.
 * @param {string[]} args CLI args.
 * @param {{ env?: Record<string, string | undefined>, cwd?: string, dryRun?: boolean, silent?: boolean, label?: string, displayArgs?: string[] }} [options] Spawn options.
 * @param {Record<string, string | undefined>} [options.env] Environment overrides.
 * @param {string} [options.cwd] Working directory.
 * @param {boolean} [options.dryRun] When true, log but skip execution.
 * @param {boolean} [options.silent] When true, suppress stdout and stderr from the child process.
 * @param {string} [options.label] Friendly name used in log output and error messages instead of the command path.
 * @param {string[]} [options.displayArgs] Args shown in the log instead of the real args (e.g. to hide an entry-point path).
 * @returns {Promise<void>} Resolves when the command exits successfully.
 */
export async function runCommand(
  command: string,
  args: string[],
  options: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    dryRun?: boolean;
    silent?: boolean;
    label?: string;
    displayArgs?: string[];
  } = {},
): Promise<void> {
  logCommand(options.label ?? command, options.displayArgs ?? args, options.cwd);
  if (options.dryRun) return;

  const child = spawn(command, args, {
    stdio: options.silent ? ['inherit', 'ignore', 'ignore'] : 'inherit',
    env: { ...process.env, ...options.env },
    cwd: options.cwd,
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code: number | null) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new ExitError(exitCode, `${options.label ?? command} failed with exit code ${exitCode}`);
  }
}
