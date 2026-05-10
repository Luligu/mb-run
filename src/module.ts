/**
 * @description This file contains the main entry point for the mb-run command.
 * @file module.ts
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

import path from 'node:path';
import process from 'node:process';

import { clearEnd, getElapsed, green, log, moveUp, savePos, shouldUseAnsi } from './ansi.js';
import { runBin, runWorkspaceBuild } from './build.js';
import { cleanOnly, fileExists, resetClean } from './clean.js';
import { runEsbuild } from './esbuild.js';
import { printPackUsage, printPublishUsage, printUsage, printVersionUsage } from './help.js';
import { isPlugin } from './helpers.js';
import { systemInfo } from './info.js';
import { initLogger } from './logger.js';
import { runOxFormat } from './oxfmt.js';
import { runPack } from './pack.js';
import { runPublish } from './publish.js';
import { sortAll } from './sort.js';
import { ExitError, runCommand } from './spawn.js';
import { runUpdate } from './update.js';
import { runUpgrade } from './upgrade.js';
import { parseVersionTag, updateRootVersion, updateWorkspaceDependencyVersions } from './version.js';

// IMPORTANT: This script operates on the package.json in the current working directory.
// It may be executed from other repos/packages, so do not assume the script's own path.
const isWindows = process.platform === 'win32';

/**
 * CLI entrypoint.
 */
export async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const rawArgs = process.argv.slice(2);

  // Validate that the current working directory is a package root.
  if (!(await fileExists(path.join(repoRoot, 'package.json')))) {
    printUsage();
    throw new ExitError(1, `No package.json found in current working directory: ${repoRoot}`);
  }

  if (rawArgs.length === 0) {
    printUsage();
    throw new ExitError(1, 'No arguments provided');
  }
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printUsage();
    return;
  }

  const known = new Set([
    '--build',
    '--production',
    '--install',
    '--clean',
    '--watch',
    '--test',
    '--lint',
    '--lint-fix',
    '--format',
    '--format-check',
    '--oxformat',
    '--dry-run',
    '--sort',
    '--update',
    '--upgrade',
    '--reset',
    '--deep-clean',
    '--version',
    '--pack',
    '--publish',
    '--esbuild',
    '--verbose',
    '--info',
    '--help',
    '-h',
  ]);

  const dryRunMode = rawArgs.includes('--dry-run');
  const verboseCommands = rawArgs.includes('--verbose');
  initLogger({ dryRun: dryRunMode, verbose: verboseCommands, rootDir: repoRoot });

  const restorePos = (rows: number = 1) => (rows > 0 && shouldUseAnsi() && !dryRunMode && !verboseCommands ? moveUp(rows) : '');

  const buildOpts = { rootDir: repoRoot, isWindows, dryRun: dryRunMode };

  const versionIndex = rawArgs.indexOf('--version');
  const candidateVersionArg = versionIndex >= 0 ? rawArgs[versionIndex + 1] : undefined;
  const rawVersionTag = typeof candidateVersionArg === 'string' && !candidateVersionArg.startsWith('-') ? candidateVersionArg : undefined;

  const packIndex = rawArgs.indexOf('--pack');
  const candidatePackArg = packIndex >= 0 ? rawArgs[packIndex + 1] : undefined;
  const rawPackTag = typeof candidatePackArg === 'string' && !candidatePackArg.startsWith('-') ? candidatePackArg : undefined;

  const publishIndex = rawArgs.indexOf('--publish');
  const candidatePublishArg = publishIndex >= 0 ? rawArgs[publishIndex + 1] : undefined;
  const rawPublishTag = typeof candidatePublishArg === 'string' && !candidatePublishArg.startsWith('-') ? candidatePublishArg : undefined;

  const upgradeIndex = rawArgs.indexOf('--upgrade');
  const upgradeValidKeywords = new Set(['jest', 'vitest', 'promiserules', 'typeaware', 'experimental']);
  const upgradeArgIndices = new Set<number>();
  const upgradeArgs = new Set<string>();
  if (upgradeIndex >= 0) {
    for (let i = upgradeIndex + 1; i < rawArgs.length; i++) {
      if (rawArgs[i].startsWith('-')) break;
      if (upgradeValidKeywords.has(rawArgs[i])) {
        upgradeArgs.add(rawArgs[i]);
        upgradeArgIndices.add(i);
      }
    }
  }

  const unknownFlags = rawArgs.filter((a) => a.startsWith('-') && !known.has(a));
  if (unknownFlags.length > 0) {
    printUsage();
    throw new ExitError(1, `Unknown argument(s): ${unknownFlags.join(' ')}`);
  }

  const unknownPositionals = rawArgs.filter(
    (a, i) =>
      !a.startsWith('-') &&
      !(versionIndex >= 0 && rawVersionTag !== undefined && i === versionIndex + 1) &&
      !(packIndex >= 0 && rawPackTag !== undefined && i === packIndex + 1) &&
      !(publishIndex >= 0 && rawPublishTag !== undefined && i === publishIndex + 1) &&
      !upgradeArgIndices.has(i),
  );
  if (unknownPositionals.length > 0) {
    printUsage();
    throw new ExitError(1, `Unknown argument(s): ${unknownPositionals.join(' ')}`);
  }

  let versionTag: 'dev' | 'edge' | 'git' | 'local' | 'next' | 'alpha' | 'beta' | null = null;
  if (versionIndex >= 0 && rawVersionTag !== undefined) {
    try {
      versionTag = parseVersionTag(rawVersionTag);
    } catch {
      printVersionUsage();
      throw new ExitError(1, 'Invalid --version usage');
    }
  }

  let packTag: 'dev' | 'edge' | 'git' | 'local' | 'next' | 'alpha' | 'beta' | null = null;
  if (packIndex >= 0 && rawPackTag !== undefined) {
    try {
      packTag = parseVersionTag(rawPackTag);
    } catch {
      printPackUsage();
      throw new ExitError(1, 'Invalid --pack tag');
    }
  }

  let publishTag: 'dev' | 'edge' | 'git' | 'local' | 'next' | 'alpha' | 'beta' | null = null;
  if (publishIndex >= 0 && rawPublishTag !== undefined) {
    try {
      publishTag = parseVersionTag(rawPublishTag);
    } catch {
      printPublishUsage();
      throw new ExitError(1, 'Invalid --publish tag');
    }
  }

  const want = {
    install: rawArgs.includes('--install'),
    clean: rawArgs.includes('--clean'),
    build: rawArgs.includes('--build'),
    production: rawArgs.includes('--production'),
    version: rawArgs.includes('--version'),
    watch: rawArgs.includes('--watch'),
    test: rawArgs.includes('--test'),
    lint: rawArgs.includes('--lint'),
    lintFix: rawArgs.includes('--lint-fix'),
    format: rawArgs.includes('--format'),
    formatCheck: rawArgs.includes('--format-check'),
    oxformat: rawArgs.includes('--oxformat'),
    sort: rawArgs.includes('--sort'),
    update: rawArgs.includes('--update'),
    upgrade: rawArgs.includes('--upgrade'),
    reset: rawArgs.includes('--reset'),
    deepClean: rawArgs.includes('--deep-clean'),
    pack: rawArgs.includes('--pack'),
    publish: rawArgs.includes('--publish'),
    esbuild: rawArgs.includes('--esbuild'),
    info: rawArgs.includes('--info'),
  };

  if (want.info) {
    systemInfo();
  }

  // --update runs npm install internally; skip the redundant standalone install.
  if (want.update) {
    want.install = false;
  }

  // --upgrade only rewrites package.json files; a subsequent install is still needed.
  if (want.upgrade) {
    want.install = false;
  }

  // --reset runs npm install internally; skip the redundant standalone install and clean and build steps since reset implies a clean slate and fresh build.
  if (want.reset) {
    want.install = false;
    want.deepClean = false;
    want.clean = false;
    want.build = false;
  }

  if (want.install) {
    log(`${savePos()}⏳ Installing...`);
    await runCommand('npm', ['install', '--no-fund', '--no-audit', '--silent'], { dryRun: dryRunMode });
    if (await isPlugin(repoRoot)) await runCommand('npm', ['link', 'matterbridge', '--no-fund', '--no-audit', '--silent'], { cwd: repoRoot, dryRun: dryRunMode });
    log(`${restorePos()}${green('✅')} Install complete in ${getElapsed()}.${clearEnd()}`);
  }

  if (want.update) {
    log(`${savePos()}⏳ Updating dependencies...`);
    await runUpdate(buildOpts);
    await runCommand('npm', ['install', '--no-fund', '--no-audit', '--silent'], { dryRun: dryRunMode });
    if (await isPlugin(repoRoot)) await runCommand('npm', ['link', 'matterbridge', '--no-fund', '--no-audit', '--silent'], { cwd: repoRoot, dryRun: dryRunMode });
    log(`${restorePos()}${green('✅')} Update complete in ${getElapsed()}.${clearEnd()}`);
  }

  if (want.upgrade) {
    log(`${savePos()}⏳ Upgrading package...`);
    await runUpgrade({
      rootDir: repoRoot,
      isWindows,
      dryRun: dryRunMode,
      enableJest: upgradeArgs.has('jest'),
      enableVitest: upgradeArgs.has('vitest'),
      enablePromiseRules: upgradeArgs.has('promiserules'),
      enableExperimental: upgradeArgs.has('experimental'),
      enableTypeAware: upgradeArgs.has('typeaware'),
    });
    await runCommand('npm', ['install', '--no-fund', '--no-audit', '--silent'], { dryRun: dryRunMode });
    if (await isPlugin(repoRoot)) await runCommand('npm', ['link', 'matterbridge', '--no-fund', '--no-audit', '--silent'], { cwd: repoRoot, dryRun: dryRunMode });
    log(`${restorePos(0)}${green('✅')} Upgrade complete in ${getElapsed()}.${clearEnd()}`);
  }

  if (want.deepClean) {
    log(`${savePos()}⏳ Deep cleaning...`);
    await resetClean({ rootDir: repoRoot, dryRun: dryRunMode });
    log(`${restorePos()}${green('✅')} Deep clean complete in ${getElapsed()}.${clearEnd()}`);
  }

  // Keep behavior deterministic; mimic common workflow ordering.
  if (want.reset) {
    log(`${savePos()}⏳ Cleaning...`);
    await resetClean({ rootDir: repoRoot, dryRun: dryRunMode });

    log(`${restorePos()}⏳ Installing...`);
    await runCommand('npm', ['install', '--no-fund', '--no-audit', '--silent'], { dryRun: dryRunMode });

    if (await isPlugin(repoRoot)) {
      log(`${restorePos()}⏳ Linking...`);
      await runCommand('npm', ['link', 'matterbridge', '--no-fund', '--no-audit', '--silent'], { cwd: repoRoot, dryRun: dryRunMode });
    }
    log(`${restorePos()}⏳ Building...`);
    await runWorkspaceBuild({ ...buildOpts, mode: want.production ? 'production' : 'build', watch: false });

    log(`${restorePos()}${green('✅')} Reset complete in ${getElapsed()}.${clearEnd()}`);
  }

  if (want.version) {
    log(`${savePos()}⏳ Versioning...`);
    // Run versioning first so subsequent steps see the updated package.json version.
    // (Intentionally does not run npm install.)
    const versionOpts = { rootDir: repoRoot, dryRun: dryRunMode };
    const nextVersion = await updateRootVersion(versionTag, versionOpts);
    await updateWorkspaceDependencyVersions(nextVersion, versionOpts);
    await runCommand('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', '--silent'], {
      cwd: repoRoot,
      dryRun: dryRunMode,
    });
    log(`${restorePos()}${green('✅')} Versioning to ${nextVersion} complete in ${getElapsed()}.${clearEnd()}`);
  }

  if (want.clean) {
    log(`${savePos()}⏳ Cleaning...`);
    await cleanOnly({ rootDir: repoRoot, dryRun: dryRunMode });
    log(`${restorePos()}${green('✅')} Clean complete in ${getElapsed()}.${clearEnd()}`);
  }

  if (want.build && want.production) {
    log(`${savePos()}⏳ Building for production...`);
    await runWorkspaceBuild({ ...buildOpts, mode: 'production', watch: false });
    log(`${restorePos()}${green('✅')} Build for production complete in ${getElapsed()}.${clearEnd()}`);
  } else if (want.build) {
    log(`${savePos()}⏳ Building...`);
    await runWorkspaceBuild({ ...buildOpts, mode: 'build', watch: false });
    log(`${restorePos()}${green('✅')} Build complete in ${getElapsed()}.${clearEnd()}`);
  }

  if (want.test) {
    log(`${savePos()}⏳ Testing...`);
    await runBin(
      'jest',
      ['--maxWorkers=100%'],
      { ...buildOpts, mode: 'build', watch: false },
      {
        env: {
          NODE_OPTIONS: '--experimental-vm-modules --no-warnings',
        },
      },
    );
    log(`${restorePos()}${green('✅')} Tests complete in ${getElapsed()}.${clearEnd()}`);
  }

  if (want.format) {
    log(`${savePos()}⏳ Formatting...`);
    await runBin('prettier', ['--log-level=silent', '--cache', '--cache-location', '.cache/.prettiercache', '--write', '.'], { ...buildOpts, mode: 'build', watch: false });
    log(`${restorePos()}${green('✅')} Format complete in ${getElapsed()}.${clearEnd()}`);
  } else if (want.formatCheck) {
    log(`${savePos()}⏳ Checking format...`);
    await runBin('prettier', ['--log-level=silent', '--cache', '--cache-location', '.cache/.prettiercache', '--check', '.'], { ...buildOpts, mode: 'build', watch: false });
    log(`${restorePos()}${green('✅')} Format check complete in ${getElapsed()}.${clearEnd()}`);
  }

  if (want.oxformat) {
    log(`${savePos()}⏳ Formatting with oxfmt...`);
    const oxResult = await runOxFormat(buildOpts);
    log(
      `${restorePos()}${green('✅')} Oxfmt format complete in ${getElapsed()} (${oxResult.filesScanned} files, ${oxResult.filesChanged} changed, ${oxResult.totalErrors} errors).${clearEnd()}`,
    );
  }

  if (want.lintFix) {
    log(`${savePos()}⏳ Linting with fix...`);
    await runBin('eslint', ['--cache', '--cache-location', '.cache/.eslintcache', '--fix', '--max-warnings=0', '.'], { ...buildOpts, mode: 'build', watch: false });
    log(`${restorePos()}${green('✅')} Lint fix complete in ${getElapsed()}.${clearEnd()}`);
  } else if (want.lint) {
    log(`${savePos()}⏳ Linting...`);
    await runBin('eslint', ['--cache', '--cache-location', '.cache/.eslintcache', '--max-warnings=0', '.'], { ...buildOpts, mode: 'build', watch: false });
    log(`${restorePos()}${green('✅')} Lint complete in ${getElapsed()}.${clearEnd()}`);
  }

  if (want.sort) {
    log(`${savePos()}⏳ Sorting package.json files...`);
    if (!dryRunMode) {
      await sortAll(repoRoot);
    }
    await runBin('prettier', ['--log-level=silent', '--cache', '--cache-location', '.cache/.prettiercache', '--write', '.'], { ...buildOpts, mode: 'build', watch: false });
    log(`${restorePos()}${green('✅')} Sort complete in ${getElapsed()}.${clearEnd()}`);
  }

  if (want.pack) {
    log(`${savePos()}⏳ Packing...`);
    await runPack({ ...buildOpts, tag: packTag });
    log(`${restorePos(0)}${green('✅')} Pack complete in ${getElapsed()}.${clearEnd()}`);
  }

  if (want.publish) {
    log(`${savePos()}⏳ Publishing...`);
    await runPublish({ rootDir: repoRoot, isWindows, dryRun: dryRunMode, tag: publishTag });
    log(`${restorePos(0)}${green('✅')} Publish complete in ${getElapsed()}.${clearEnd()}`);
  }

  if (want.esbuild) {
    log(`${savePos()}⏳ Bundling with esbuild...`);
    await runEsbuild(buildOpts);
    log(`${restorePos()}${green('✅')} Esbuild complete in ${getElapsed()}.${clearEnd()}`);
  }

  if (want.watch) {
    // Keep watch consistent with the non-production build mode.
    await runWorkspaceBuild({ ...buildOpts, mode: 'build', watch: true });
  }
}
