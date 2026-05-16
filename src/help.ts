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

  // Formats one option row with a 26-char visible flag+args column.
  const f = (flag: string, args = ''): string => {
    const visible = args ? `${flag} ${args}` : flag;
    const pad = ' '.repeat(Math.max(1, 26 - visible.length));
    return args ? `${green(flag)} ${brightBlack(args)}${pad}` : `${green(flag)}${pad}`;
  };

  const msg = `\
${title}

Runs the same operations as the package.json scripts in the current working directory, but executes the local
binaries in node_modules/.bin directly (does not call npm scripts).

${brightYellow('Usage:')} ${green('mb-run')} ${brightBlack('[options...]')}

${brightYellow('Execution order:')} ${brightBlack('install → update → deep-clean → reset → clean → build → test → format → oxformat → lint → oxlint → sort → watch')}

${brightYellow('Options:')}
  ${f('--install')}run npm install --no-fund --no-audit
  ${f('--reset', '[--production]')}empty .cache/ and node_modules/, run npm install and build; --production uses tsconfig.build.production.json
  ${f('--deep-clean')}empty .cache/ and node_modules/ like --reset but skips install and build
  ${f('--clean')}remove build output directories
  ${f('--build', '[--production]')}compile with tsc; prefers tsconfig.build.json; --production prefers tsconfig.build.production.json
  ${f('--watch')}run tsc in watch mode
  ${f('--test')}run tests with NODE_OPTIONS="--experimental-vm-modules --no-warnings"
  ${f('--lint')}run eslint --max-warnings=0
  ${f('--lint-fix')}run eslint --fix --max-warnings=0
  ${f('--format')}run prettier --write
  ${f('--format-check')}run prettier --check
  ${f('--oxformat')}format source files via oxfmt JS API (reads .oxfmtrc.json when present)
  ${f('--oxlint')}lint source files via oxlint (reads .oxlintrc.json when present, otherwise uses bundled default)
  ${f('--sort')}sort top-level keys in all package.json files
  ${f('--update')}run ncu -u across all workspaces then npm install
  ${f('--upgrade', '[keywords...]')}upgrade config files; keywords: jest | vitest | promiserules | typeaware | experimental
  ${f('--pack', '[tag]')}back up, clean, build, npm pack, and restore; bumps version first if tag is provided
  ${f('--publish', '[tag]')}back up, npm publish for root and all workspaces, and restore; bumps version first if tag is provided
  ${f('--esbuild')}bundle with esbuild
  ${f('--version', '[tag]')}update versions for the current package and all workspaces
  ${f('--dry-run')}log intended actions without executing commands or writing files
  ${f('--verbose')}print each command before it is executed
  ${f('--info')}print system information (platform, hostname, memory, network, Node.js/npm versions)
  ${green('--help')}, ${green('-h')}${' '.repeat(16)}print this help message

  ${brightBlack('Version tags:')} dev | edge | git | local | next | alpha | beta
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
