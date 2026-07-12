/**
 * @file src/self.worker.ts
 * @description This worker checks npm for a newer mb-run release.
 * @author Luca Liguori
 * @created 2026-07-12
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
import { parentPort } from 'node:worker_threads';

import { isNewerVersion } from './self.js';

const packageJsonUrl = new URL('../package.json', import.meta.url);
const registryUrl = 'https://registry.npmjs.org/mb-run/latest';

/**
 * Checks npm and notifies the parent when a newer release exists.
 *
 * @returns {Promise<void>} Resolves after the check completes or is skipped.
 */
export async function runSelfUpdateCheck(): Promise<void> {
  try {
    const packageJson: unknown = JSON.parse(await readFile(packageJsonUrl, 'utf8'));
    if (packageJson === null || typeof packageJson !== 'object' || !('version' in packageJson) || typeof packageJson.version !== 'string') return;

    const response = await fetch(registryUrl, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return;
    const registryData: unknown = await response.json();
    if (registryData === null || typeof registryData !== 'object' || !('version' in registryData) || typeof registryData.version !== 'string') return;

    if (isNewerVersion(registryData.version, packageJson.version)) {
      parentPort?.postMessage({ currentVersion: packageJson.version, latestVersion: registryData.version });
    }
  } catch {
    // The background self-update check must never prevent the requested command.
  }
}

void runSelfUpdateCheck();
