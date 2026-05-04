/**
 * @description This file contains system information utilities for the mb-run command.
 * @file info.ts
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

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { log } from './ansi.js';

/**
 * Formats a byte count as a human-readable string (GB, MB, or KB).
 *
 * @param {number} bytes Number of bytes.
 * @returns {string} Human-readable size string.
 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Formats an uptime duration (in seconds) as a human-readable string.
 *
 * @param {number} seconds Total uptime in seconds.
 * @returns {string} Human-readable uptime string, e.g. "up 2 days, 3 hours, 15 minutes".
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  return parts.length > 0 ? `up ${parts.join(', ')}` : 'up less than a minute';
}

/**
 * Returns the first non-internal IPv4 address found among all network interfaces.
 *
 * @returns {string} IPv4 address string, or "unavailable" if none found.
 */
function getPrimaryIpv4(): string {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return 'unavailable';
}

/**
 * Returns all non-internal IPv6 addresses found among all network interfaces.
 *
 * @returns {string} Space-separated IPv6 addresses, or "none" if none found.
 */
function getIpv6Addresses(): string {
  const addrs: string[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv6' && !addr.internal) addrs.push(addr.address);
    }
  }
  return addrs.length > 0 ? addrs.join(' ') : 'none';
}

/**
 * Resolves candidate paths for npm's package.json based on the Node.js executable location.
 *
 * On Windows, npm lives alongside the node binary.
 * On Unix-like systems, it is typically one level up under lib/node_modules/npm.
 *
 * @param {string} nodeBinDir Directory containing the node executable.
 * @returns {string[]} Ordered list of candidate paths to try.
 */
function npmPackageJsonCandidates(nodeBinDir: string): string[] {
  return [
    // Windows: C:\Program Files\nodejs\node_modules\npm\package.json
    path.join(nodeBinDir, 'node_modules', 'npm', 'package.json'),
    // Unix: /usr/local/bin/../lib/node_modules/npm/package.json
    path.join(nodeBinDir, '..', 'lib', 'node_modules', 'npm', 'package.json'),
    // Fallback: /usr/lib/node_modules/npm/package.json
    '/usr/lib/node_modules/npm/package.json',
  ];
}

/**
 * Resolves the npm version by reading npm's own package.json relative to the Node.js
 * executable, falling back to the npm_config_user_agent environment variable, and
 * finally returning "unavailable" if neither source is accessible.
 *
 * @returns {string} npm version string, or "unavailable".
 */
function getNpmVersion(): string {
  const nodeBinDir = path.dirname(process.execPath);
  for (const candidate of npmPackageJsonCandidates(nodeBinDir)) {
    try {
      const raw = readFileSync(candidate, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object' && 'version' in parsed && typeof (parsed as Record<string, unknown>)['version'] === 'string') {
        return (parsed as Record<string, string>)['version'];
      }
    } catch {
      // try next candidate
    }
  }
  // Fallback: when invoked via an npm script, this env var carries the version.
  const agent = process.env['npm_config_user_agent'];
  if (agent) {
    const match = /^npm\/(\S+)/u.exec(agent);
    if (match?.[1]) return match[1];
  }
  return 'unavailable';
}

/**
 * Prints a snapshot of the current system environment to stdout using only
 * Node.js built-in `os`, `process`, and `process.env` — no child process or exec.
 *
 * Displayed information:
 * - Platform, architecture, kernel version
 * - Current user and hostname
 * - System uptime, current date/time
 * - Total and used memory
 * - Primary IPv4 and all non-internal IPv6 addresses
 * - Node.js and npm versions
 */
export function systemInfo(): void {
  const total = os.totalmem();
  const used = total - os.freemem();

  let username = 'unavailable';
  try {
    username = os.userInfo().username;
  } catch {
    // os.userInfo() can throw a SystemError on some platforms
  }

  log(`\u{1F4BB}  Platform:     ${os.type()} ${os.arch()}`);
  log(`\u{1F9E9}  Kernel:       ${os.release()} / ${os.version()}`);
  log(`\u{1F464}  User:         ${username}`);
  log(`\u{1F516}  Hostname:     ${os.hostname()}`);
  log(`\u{23F3}  Uptime:       ${formatUptime(os.uptime())}`);
  log(`\u{1F4C5}  Date:         ${new Date().toString()}`);
  log(`\u{1F9E0}  Memory:       ${formatBytes(used)} used / ${formatBytes(total)} total`);
  log(`\u{1F310}  IPv4:         ${getPrimaryIpv4()}`);
  log(`\u{1F310}  IPv6:         ${getIpv6Addresses()}`);
  log(`\u{1F7E2}  Node.js:      ${process.version.replace(/^v/u, '')}`);
  log(`\u{1F7E3}  Npm:          ${getNpmVersion()}`);
}
