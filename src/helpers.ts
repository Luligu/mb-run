/**
 * @description This file contains shared helper utilities for the mb-run command.
 * @file helpers.ts
 * @author Luca Liguori
 * @created 2026-05-04
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

import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { logDelete } from './logger.js';

/** Context shared by file-removal operations. */
export interface RemoveFileOptions {
  /** When true, log but skip file-system writes. */
  dryRun: boolean;
}

/**
 * Removes a file, silently succeeding when it is missing.
 *
 * @param {string} filePath Absolute or relative file path to remove.
 * @param {RemoveFileOptions} opts File-removal options.
 * @returns {Promise<void>} Resolves when the file is removed or skipped.
 */
export async function removeFile(filePath: string, opts: RemoveFileOptions): Promise<void> {
  logDelete(filePath);
  if (opts.dryRun) return;
  await rm(filePath, { force: true });
}

/**
 * Reads and parses the package.json file in the given directory.
 *
 * @param {string} rootDir Directory containing the package.json to read.
 * @returns {Promise<Record<string, unknown>>} Parsed package.json content.
 * @throws {Error} If the file cannot be read or contains invalid JSON.
 */
export async function parsePackageJson(rootDir: string): Promise<Record<string, unknown>> {
  const packageJsonPath = path.join(rootDir, 'package.json');
  try {
    const raw = await readFile(packageJsonPath, 'utf8');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Failed to read or parse ${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/**
 * Checks if the current package.json scripts indicate we're running in a plugin context.
 *
 * @param {string} rootDir Repository root directory containing the package.json to inspect.
 * @returns {Promise<boolean>} True if we're in a plugin context.
 */
export async function isPlugin(rootDir: string): Promise<boolean> {
  const pkg = (await parsePackageJson(rootDir)) as {
    scripts?: Record<string, string>;
  };
  return (
    pkg?.scripts?.start === 'matterbridge' ||
    pkg?.scripts?.['link'] === 'npm link --no-fund --no-audit matterbridge' ||
    pkg?.scripts?.['dev:link'] === 'npm link --no-fund --no-audit matterbridge'
  );
}

/**
 * Checks whether the package uses the Oxc formatter and linter.
 *
 * @param {string} rootDir Repository root directory containing the package.json to inspect.
 * @returns {Promise<boolean>} True when both oxfmt and oxlint are dev dependencies.
 */
export async function hasOxc(rootDir: string): Promise<boolean> {
  const pkg = (await parsePackageJson(rootDir)) as { devDependencies?: unknown };
  if (!pkg.devDependencies || typeof pkg.devDependencies !== 'object') return false;

  return Object.hasOwn(pkg.devDependencies, 'oxfmt') && Object.hasOwn(pkg.devDependencies, 'oxlint');
}

/**
 * Checks whether the package is explicitly declared as a library or its production tsconfig matches the library pattern.
 *
 * @param {string} rootDir Repository root directory containing package.json and tsconfig.build.production.json to inspect.
 * @returns {Promise<boolean>} True when `automator.library` is true or the production tsconfig matches the library pattern.
 */
export async function isLibrary(rootDir: string): Promise<boolean> {
  const packageJson = await parsePackageJson(rootDir);
  const automator = packageJson['automator'];
  if (typeof automator === 'object' && automator !== null && !Array.isArray(automator)) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    if ((automator as Record<string, unknown>)['library'] === true) return true;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const production = JSON.parse(await readFile(path.join(rootDir, 'tsconfig.build.production.json'), 'utf8')) as {
    compilerOptions?: {
      declaration: boolean | undefined;
      declarationMap: boolean | undefined;
      sourceMap: boolean | undefined;
      removeComments: boolean | undefined;
    };
  };
  return (
    production.compilerOptions?.declaration === true &&
    production.compilerOptions?.declarationMap === true &&
    production.compilerOptions?.sourceMap === true &&
    production.compilerOptions?.removeComments === false
  );
}

/**
 * Checks if the current package.json defines a monorepo via the workspaces key.
 *
 * @param {string} rootDir Repository root directory containing the package.json to inspect.
 * @returns {Promise<boolean>} True if the package.json has a workspaces field.
 */
export async function isMonorepo(rootDir: string): Promise<boolean> {
  const pkg = await parsePackageJson(rootDir);

  return pkg?.workspaces !== undefined;
}
