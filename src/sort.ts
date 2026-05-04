/**
 * @description This file contains package.json property-sorting utilities for the mb-run command.
 * @file sort.ts
 * @author Luca Liguori
 * @created 2026-05-02
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

import { backup, packageJsonMap, restore } from './cache.js';

/**
 * The canonical top-level property order for package.json files.
 * Derived from this repository's own package.json.
 * Optional dependency sections (peer, bundle, optional) follow devDependencies.
 * Unknown keys are appended after all known keys, in their original relative order.
 */
export const PACKAGE_JSON_KEY_ORDER: string[] = [
  'name',
  'version',
  'description',
  'author',
  'license',
  'homepage',
  'repository',
  'bugs',
  'funding',
  'keywords',
  'type',
  'main',
  'types',
  'exports',
  'workspaces',
  'engines',
  'bin',
  'files',
  'scripts',
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'optionalDependencies',
  'bundleDependencies',
];

/**
 * Returns a new object with the top-level properties of `pkg` reordered according to
 * {@link PACKAGE_JSON_KEY_ORDER}. Sub-properties and array contents are not reordered.
 * Unknown keys are appended after all known keys, in their original relative order.
 *
 * @param {Record<string, unknown>} pkg Parsed package.json object.
 * @returns {Record<string, unknown>} New object with sorted top-level keys.
 */
export function sortPackageJson(pkg: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};

  for (const key of PACKAGE_JSON_KEY_ORDER) {
    if (Object.prototype.hasOwnProperty.call(pkg, key)) {
      sorted[key] = pkg[key];
    }
  }

  for (const key of Object.keys(pkg)) {
    if (!Object.prototype.hasOwnProperty.call(sorted, key)) {
      sorted[key] = pkg[key];
    }
  }

  return sorted;
}

/**
 * Backs up all package.json files from the project into memory, sorts their top-level
 * properties using {@link PACKAGE_JSON_KEY_ORDER}, and writes the sorted content back
 * to disk via {@link restore}.
 *
 * @param {string} rootDir Root directory of the project.
 * @returns {Promise<void>} Resolves when all package.json files have been sorted and written.
 */
export async function sortAll(rootDir: string): Promise<void> {
  await backup(rootDir);
  for (const [name, pkg] of packageJsonMap) {
    packageJsonMap.set(name, sortPackageJson(pkg));
  }
  await restore(rootDir);
}
