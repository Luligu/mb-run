/**
 * @description This file contains CLI help text for the mb-run command.
 * @file help.ts
 * @author Luca Liguori
 * @created 2026-04-30
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

import pkg from '../package.json' with { type: 'json' };
import { brightBlack, brightCyan, brightWhite, brightYellow, cyan, green, log } from './ansi.js';

/**
 * Prints CLI usage text.
 */
export function printUsage(): void {
  const title = `${brightCyan('mb-run')} ${brightBlack('version')} ${brightWhite(pkg.version)}`;
  const usageLine = `${brightYellow('Usage:')} ${green('mb-run')} [--install] [--reset [--production]] [--clean] [--deep-clean] [--build [--production]] [--watch] [--test] [--lint|--lint-fix] [--format|--format-check] [--sort] [--update] [--pack [dev|edge|git|local|next|alpha|beta]] [--publish [dev|edge|git|local|next|alpha|beta]] [--dry-run] [--version [dev|edge|git|local|next|alpha|beta]] [--info]`;
  const msg = `\
${title}

Runs the same operations as the package.json scripts in the current working directory, but executes the local
binaries in node_modules/.bin directly (does not call npm scripts).

${usageLine}

${brightYellow('Notes:')}
- ${cyan('Multiple flags')} are run in this order: ${brightBlack('install → update → deep-clean → reset → clean → build → test → format → lint → sort → watch')}
- ${green('--install')} runs npm install --no-fund --no-audit
- ${green('--reset')} empties .cache/ and node_modules/ (keeps directories for devcontainer named volumes), then runs npm install and build
- ${green('--deep-clean')} empties .cache/ and node_modules/ like --reset but skips the install and build steps
- ${green('--test')} sets NODE_OPTIONS="--experimental-vm-modules --no-warnings" like the existing scripts
- ${green('--lint-fix')} runs eslint with --fix
- ${green('--format-check')} runs prettier with --check
- ${green('--build')} prefers per-workspace tsconfig.build.json when present
- ${green('--build --production')} prefers tsconfig.build.production.json, else tsconfig.build.json, else tsconfig.json
- ${green('--reset --production')} performs a reset and rebuilds using the production tsconfig
- ${green('--sort')} sorts top-level keys in all package.json files (root and workspaces) using the canonical key order
- ${green('--update')} installs npm-check-updates (--no-save) then runs ncu -u across all workspaces
- ${green('--pack')} [tag] backs up package.json, cleans, builds for production, strips devDependencies and scripts, empties node_modules, runs npm install --omit=dev, npm shrinkwrap, npm pack, then restores package.json and reinstalls; if a tag is provided it first bumps the version
- ${green('--publish')} [tag] backs up all package.json files (root and workspaces), strips devDependencies and scripts from each, runs npm publish --dry-run for root and every workspace, then restores all package.json files; if a tag is provided it first bumps the version
- ${green('--dry-run')} logs intended actions without changing files or executing commands
- ${green('--version')} updates versions for the current package and all configured workspaces
- ${green('--verbose')} prints each external command before it is executed
- ${green('--info')} prints system information (platform, hostname, memory, network, Node.js/npm versions)
`;

  log(msg);
}

/**
 * Prints usage text for the --version mode.
 */
export function printVersionUsage(): void {
  const msg = [
    `${brightYellow('Usage:')} ${green('mb-run')} ${green('--version')} [dev|edge|git|local|next|alpha|beta]`,
    `${cyan('Updates')} package.json + package-lock.json (current package and workspaces) version to:`,
    `  ${brightBlack('<baseVersion>-<dev|edge|git|local|next|alpha|beta>-<yyyymmdd>-<7charSha>')}`,
    `Or with no tag, strips the suffix back to ${brightBlack('<baseVersion>')}.`,
  ].join('\n');

  log(msg);
}

/**
 * Prints usage text for the --pack mode.
 */
export function printPackUsage(): void {
  const msg = [
    `${brightYellow('Usage:')} ${green('mb-run')} ${green('--pack')} [dev|edge|git|local|next|alpha|beta]`,
    `${cyan('Runs')} the full pack workflow. With an optional tag, first bumps the version to:`,
    `  ${brightBlack('<baseVersion>-<dev|edge|git|local|next|alpha|beta>-<yyyymmdd>-<7charSha>')}`,
    `Then backs up package.json, builds for production, packs, and restores.`,
  ].join('\n');

  log(msg);
}

/**
 * Prints usage text for the --publish mode.
 */
export function printPublishUsage(): void {
  const msg = [
    `${brightYellow('Usage:')} ${green('mb-run')} ${green('--publish')} [dev|edge|git|local|next|alpha|beta]`,
    `${cyan('Runs')} the full publish workflow. With an optional tag, first bumps the version to:`,
    `  ${brightBlack('<baseVersion>-<dev|edge|git|local|next|alpha|beta>-<yyyymmdd>-<7charSha>')}`,
    `Then backs up all package.json files, publishes, and restores.`,
  ].join('\n');

  log(msg);
}
