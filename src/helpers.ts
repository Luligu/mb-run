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

import { readFile } from 'node:fs/promises';
import path from 'node:path';

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
  const pkg = (await parsePackageJson(rootDir)) as { scripts?: Record<string, string> };

  return pkg?.scripts?.start === 'matterbridge' || pkg?.scripts?.['dev:link'] === 'npm link --no-fund --no-audit matterbridge';
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
