/**
 * @file src/self.ts
 * @description This file checks whether the running mb-run package is current.
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

import { Worker } from 'node:worker_threads';

import { brightYellow, log } from './ansi.js';

/** Represents the numeric and prerelease parts of a semantic version. */
interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: boolean;
}

/**
 * Parses the semantic-version fields needed by the update check.
 *
 * @param {string} version Version string to parse.
 * @returns {ParsedVersion | undefined} Parsed version, or undefined when invalid.
 */
function parseVersion(version: string): ParsedVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/u.exec(version);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: version.includes('-'),
  };
}

/**
 * Returns whether a published version is newer than the running version.
 *
 * @param {string} latestVersion Latest version published on npm.
 * @param {string} currentVersion Currently running version.
 * @returns {boolean} True when the npm version is newer.
 */
export function isNewerVersion(latestVersion: string, currentVersion: string): boolean {
  const latest = parseVersion(latestVersion);
  const current = parseVersion(currentVersion);
  if (!latest || !current) return false;

  const latestParts = [latest.major, latest.minor, latest.patch];
  const currentParts = [current.major, current.minor, current.patch];
  for (let index = 0; index < latestParts.length; index++) {
    if (latestParts[index] !== currentParts[index]) return latestParts[index] > currentParts[index];
  }
  return current.prerelease && !latest.prerelease;
}

/**
 * Starts a background worker that checks npm for a newer mb-run release.
 *
 * The worker is unreferenced so it never delays command completion. Registry,
 * timeout, filesystem, worker, and malformed-response errors are ignored.
 *
 * @returns {void}
 */
export function checkLatestVersion(): void {
  try {
    const worker = new Worker(new URL('./self.worker.js', import.meta.url));
    worker.unref();
    worker.once('message', (message: unknown) => {
      if (message === null || typeof message !== 'object' || !('currentVersion' in message) || !('latestVersion' in message)) return;
      if (typeof message.currentVersion !== 'string' || typeof message.latestVersion !== 'string') return;
      log(brightYellow(`⚠️  A newer mb-run version is available: ${message.currentVersion} → ${message.latestVersion}. Run npm install --global mb-run@latest to update.`));
    });
    // oxlint-disable-next-line no-empty-function
    worker.once('error', () => {});
  } catch {
    // The background self-update check must never prevent the requested command.
  }
}
