/**
 * @file src/upgrade.ts
 * @description This file contains upgrade utilities for the mb-run command.
 * @author Luca Liguori
 * @created 2026-05-03
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

// oxlint-disable typescript/no-unsafe-type-assertion
// oxlint-disable complexity

import { execSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { inspect } from 'node:util';

import { cyan, green, log, magenta, red, reset } from './ansi.js';
import { resolveWorkspacePackageJsonPaths } from './cache.js';
import { fileExists } from './clean.js';
import { getErrorMessage } from './error.js';
import { isLibrary, isMonorepo, isPlugin, parsePackageJson } from './helpers.js';

const configDirname = path.dirname(url.fileURLToPath(import.meta.url));
const srcDir = path.join(configDirname, '..', 'vendor');
const commandFailures: Array<{ command: string; status: number | undefined; message: string }> = [];
let dstDir: string;

/** Context shared by all update operations. */
export interface UpgradeOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** True when running on Windows. */
  isWindows: boolean;
  /** When true, log but skip command execution and file-system writes. */
  dryRun: boolean;
  /** When true, use Node.js for execution. */
  useNode?: boolean;
  /** When true, use Bun for execution. */
  useBun?: boolean;
  /** When true, enable Jest tests. */
  enableJest?: boolean;
  /** When true, enable Vitest tests. */
  enableVitest?: boolean;
  /** When true, enable Bun tests. */
  enableBuntest?: boolean;
  /** When true, enable bundling for production builds */
  enableBundle?: boolean;
  /** When true, enable obfuscation for production builds */
  enableObfuscate?: boolean;
}

/**
 * Upgrades all dependencies in place using npm-check-updates.
 *
 * For workspace monorepos (package.json has a `workspaces` field) the update
 * covers the root and every workspace package in one call.  For plain packages
 * only the root package.json is updated.
 *
 * @param {UpgradeOptions} opts Upgrade options.
 * @returns {Promise<void>} Resolves when all package.json files have been upgraded.
 */
export async function runUpgrade(opts: UpgradeOptions): Promise<void> {
  if (opts.dryRun) return;

  commandFailures.length = 0;
  dstDir = opts.rootDir;
  log(`Upgrading ${opts.rootDir}...`);

  // Process the root package.json first to check if it's a monorepo
  const rootPkgPath = path.join(opts.rootDir, 'package.json');
  const rootPkgJson = await parsePackageJson(opts.rootDir);
  const rootPkgIsMonorepo = await isMonorepo(opts.rootDir);
  const rootPkgIsPlugin = await isPlugin(opts.rootDir);
  const rootPkgIsLibrary = await isLibrary(opts.rootDir);
  await runPackageJsonUpgrade(opts, rootPkgPath, rootPkgJson, rootPkgIsMonorepo, false, rootPkgIsPlugin, rootPkgIsLibrary);

  const workspacePackageJsonPaths = await resolveWorkspacePackageJsonPaths(opts.rootDir);
  for (const pkgPath of workspacePackageJsonPaths) {
    dstDir = path.dirname(pkgPath);
    const pkgJson = await parsePackageJson(dstDir);
    // log(`Processing workspace package: ${magenta(pkgPath)} in ${magenta(dstDir)}...`);
    log(`Upgrading workspace ${dstDir}...`);
    await runPackageJsonUpgrade({ rootDir: opts.rootDir, isWindows: opts.isWindows, dryRun: opts.dryRun }, path.join(dstDir, 'package.json'), pkgJson, false, true, false, false);
  }

  if (rootPkgIsMonorepo) {
    runSafe(`npm install --no-fund --no-audit`);
    runSafe(`npm prune --no-fund --no-audit`);
  }

  if (commandFailures.length > 0) {
    log(`${red('Failed commands:')}${reset()}\n${inspect(commandFailures, false, 2, true)}`);
  }
}

/**
 * Checks if npm-check-updates is installed and meets the minimum required version.
 *
 * @param {UpgradeOptions} opts Upgrade options.
 * @param {string} pkgPath Absolute path to the package.json to check for npm-check-updates.
 * @param {Record<string, unknown>} pkgJson Parsed package.json content to check for npm-check-updates.
 * @param {boolean} [isMonorepo] Whether the package.json belongs to a monorepo (has workspaces field).
 * @param {boolean} [isWorkspace] Whether the package.json belongs to a workspace package (not the root).
 * @param {boolean} [isPlugin] Whether the package.json belongs to a plugin (has plugin-specific scripts).
 * @param {boolean} [isLibrary] Whether the package.json belongs to a library (not an application or plugin).
 * @returns {Promise<void>} Resolves if the check passes, rejects with an error message if it fails.
 */
// oxlint-disable-next-line max-lines-per-function
export async function runPackageJsonUpgrade(
  opts: UpgradeOptions,
  pkgPath: string,
  pkgJson: Record<string, unknown>,
  isMonorepo: boolean = false,
  isWorkspace: boolean = false,
  isPlugin: boolean = false,
  isLibrary: boolean = false,
): Promise<void> {
  const automator = pkgJson.automator as
    | {
        /* use @types/node */
        node?: boolean;
        /* use @types/bun */
        bun?: boolean;
        /* use @types/jest */
        jestTypes?: boolean;
        /* use vitest/globals */
        vitestTypes?: boolean;
        /* signal is an app */
        app?: boolean;
        /* use Jest for testing */
        jest?: boolean;
        /* use Vitest for testing */
        vitest?: boolean;
        /* use Bun for testing */
        buntest?: boolean;
        /* remove git scripts */
        git?: boolean;
        /* remove version scripts */
        version?: boolean;
        /* remove publish scripts */
        publish?: boolean;
        /* use bundle */
        bundle?: boolean;
        /* use obfuscate */
        obfuscate?: boolean;
        /* signal package is private */
        private?: boolean;
        /* skip package.json modifications */
        skipPackageJson?: boolean;
        /* skip tsconfig modifications */
        skipTsconfig?: boolean;
        /* skip devcontainer modifications */
        skipDevContainer?: boolean;
        /* set coverage thresholds for tests */
        coverage?: { lines?: number; functions?: number; statements?: number; branches?: number };
      }
    | undefined;
  log(`Automator:${reset()}\n${inspect(automator, true, 2, true)}`);
  const coverage = automator?.coverage;
  log(`Automator coverage:${reset()}\n${inspect(coverage, true, 2, true)}`);
  if (automator?.node !== undefined) opts.useNode = automator.node;
  if (automator?.bun !== undefined) opts.useBun = automator.bun;
  if (automator?.jest !== undefined) opts.enableJest = automator.jest;
  if (automator?.vitest !== undefined) opts.enableVitest = automator.vitest;
  if (automator?.buntest !== undefined) opts.enableBuntest = automator.buntest;
  if (automator?.bundle !== undefined) opts.enableBundle = automator.bundle;
  if (automator?.obfuscate !== undefined) opts.enableObfuscate = automator.obfuscate;
  log(`Upgrading dependencies in ${magenta(dstDir)} ${isMonorepo ? '(monorepo)' : isWorkspace ? '(workspace)' : isPlugin ? '(plugin)' : isLibrary ? '(library)' : ''}...`);

  // Check package.json for existing keywords
  if (pkgJson.name === undefined) {
    log(
      'No name field found in package.json. It is recommended to add a name field for better compatibility with npm and to explicitly define the name of your package. For example:\n\n"name": "your-package-name"\n\nThis helps ensure that consumers of your package can correctly identify and install your package.',
    );
    await pressyAnyKey();
  }
  if (pkgJson.version === undefined) {
    log(
      'No version field found in package.json. It is recommended to add a version field for better compatibility with npm and to explicitly define the version of your package. For example:\n\n"version": "1.0.0"\n\nThis helps ensure that consumers of your package can correctly identify and install the appropriate version of your package.',
    );
    await pressyAnyKey();
  }
  if (pkgJson.description === undefined) {
    log(
      'No description field found in package.json. It is recommended to add a description field for better compatibility with npm and to explicitly define the description of your package. For example:\n\n"description": "Your package description"\n\nThis helps ensure that consumers of your package can correctly understand the purpose of your package.',
    );
    await pressyAnyKey();
  }
  if (pkgJson.private !== true && pkgJson.homepage === undefined) {
    log(
      'No homepage field found in package.json. It is recommended to add a homepage field for better compatibility with npm and to explicitly define the homepage of your package. For example:\n\n"homepage": "https://your-package-homepage.com"\n\nThis helps ensure that consumers of your package can correctly find more information about your package.',
    );
    await pressyAnyKey();
  }
  if (pkgJson.type === undefined) {
    log(
      'No type field found in package.json. It is recommended to add a type field for better compatibility with modern bundlers and to explicitly define the module type of your package. For example:\n\n"type": "module"\n\nThis helps ensure that consumers of your package can correctly resolve the appropriate module format based on their environment.',
    );
    await pressyAnyKey();
  }
  if (pkgJson.private !== true && pkgJson.main === undefined) {
    log(
      'No main field found in package.json. It is recommended to add a main field for better compatibility with modern bundlers and to explicitly define the entry point of your package. For example:\n\n"main": "dist/module.js"\n\nThis helps ensure that consumers of your package can correctly resolve the appropriate module format based on their environment.',
    );
    await pressyAnyKey();
  }
  if (pkgJson.private !== true && pkgJson.types === undefined) {
    log(
      'No types field found in package.json. It is recommended to add a types field for better compatibility with TypeScript and to explicitly define the type definitions of your package. For example:\n\n"types": "dist/module.d.ts"\n\nThis helps ensure that consumers of your package can correctly resolve the appropriate type definitions based on their environment.',
    );
    await pressyAnyKey();
  }
  if (pkgJson.private !== true && pkgJson.exports === undefined) {
    log(
      'No exports field found in package.json. It is recommended to add an exports field for better compatibility with modern bundlers and to explicitly define the entry points of your package. For example:\n\n"exports": {\n  ".": {\n    "import": "./dist/module.js",\n    "require": "./dist/module.cjs"\n  }\n}\n\nThis helps ensure that consumers of your package can correctly resolve the appropriate module format based on their environment.',
    );
    await pressyAnyKey();
  }
  if (pkgJson.repository === undefined) {
    log(
      'No repository field found in package.json. It is recommended to add a repository field for better compatibility with modern bundlers and to explicitly define the repository of your package. For example:\n\n"repository": {\n  "type": "git",\n  "url": "https://github.com/your-username/your-repo.git"\n}\n\nThis helps ensure that consumers of your package can correctly find the repository based on their environment.',
    );
    await pressyAnyKey();
  }
  if (pkgJson.private !== true && pkgJson.bugs === undefined) {
    log(
      'No bugs field found in package.json. It is recommended to add a bugs field. For example:\n\n"bugs": {\n  "url": "https://github.com/your-username/your-repo/issues"\n}\n\nThis helps ensure that consumers of your package can correctly find the bugs based on their environment.',
    );
    await pressyAnyKey();
  }
  if (pkgJson.private !== true && pkgJson.funding === undefined) {
    log(
      'No funding field found in package.json. It is recommended to add a funding field. For example:\n\n"funding": {\n  "url": "https://github.com/your-username/your-repo/funding"\n}\n\nThis helps ensure that consumers of your package can correctly find the funding based on their environment.',
    );
    await pressyAnyKey();
  }
  if (pkgJson.private !== true && pkgJson.keywords === undefined) {
    log(
      'No keywords field found in package.json. It is recommended to add a keywords field. For example:\n\n"keywords": ["keyword1", "keyword2"]\n\nThis helps ensure that consumers of your package can correctly find the keywords based on their environment.',
    );
    await pressyAnyKey();
  }
  if (automator?.app !== true && pkgJson.engines === undefined) {
    log(
      'No engines field found in package.json. It is recommended to add an engines field. For example:\n\n"engines": {\n  "node": ">=14"\n}\n\nThis helps ensure that consumers of your package can correctly find the engines based on their environment.',
    );
    await pressyAnyKey();
  }
  if (pkgJson.workspaces && !isMonorepo) {
    log(
      'Warning: workspaces field found in package.json but --monorepo-root flag not set. If this is intentional, you can ignore this warning. If this is not intentional, you may want to remove the workspaces field from your package.json.',
    );
    await pressyAnyKey();
  }
  if (existsSync(path.join(dstDir, 'packages')) && !isMonorepo) {
    log(
      'Warning: packages directory found but --monorepo-root flag not set. If this is intentional, you can ignore this warning. If this is not intentional, you may want to remove the packages directory.',
    );
    await pressyAnyKey();
  }

  // Copy .claude
  if (!isWorkspace) {
    copyRecursive('.claude', '.claude');
    copyRecursive('CLAUDE.md', 'CLAUDE.md');
    appendFileToFileIfExists('localAgents.md', 'CLAUDE.md');
    if (!isPlugin && !isMonorepo) removeDirSafe(path.join(dstDir, '.claude', 'rules', 'matterbridge'));
  }

  // Copy .codex
  if (!isWorkspace) {
    copyRecursive('.agents', '.agents');
    copyRecursive('.codex', '.codex');
    copyRecursive('AGENTS.md', 'AGENTS.md');
    appendFileToFileIfExists('localAgents.md', 'AGENTS.md');
    if (!isPlugin && !isMonorepo) unlinkSafe(path.join(dstDir, '.agents', 'matterbridge.md'));
    if (!isPlugin && !isMonorepo) removeDirSafe(path.join(dstDir, '.codex', 'rules', 'matterbridge'));
  }

  // Copy .devcontainer
  if (!isWorkspace && automator?.skipDevContainer !== true) {
    if (isPlugin) copyRecursive('.devcontainer-plugin', '.devcontainer');
    else copyRecursive('.devcontainer', '.devcontainer');
  }

  // Copy .github
  if (!isWorkspace) {
    if (isPlugin) copyRecursive('.github-plugin', '.github');
    else copyRecursive('.github', '.github');
    appendFileToFileIfExists('localAgents.md', '.github/copilot-instructions.md');
  }

  // Copy .vscode
  if (!isWorkspace) {
    mkdirSync(path.join(dstDir, '.vscode'), { recursive: true });
    copyRecursive('.vscode/settings.native.json', '.vscode/settings.json');
    copyRecursive('.vscode/extensions.native.json', '.vscode/extensions.json');
    if (!existsSync('.vscode/tasks.json')) copyRecursive('.vscode/tasks.json', '.vscode/tasks.json');
  }

  // Copy scripts
  if (automator?.app !== true) {
    mkdirSync(path.join(dstDir, 'scripts'), { recursive: true });
    if (isWorkspace) {
      copyRecursive('scripts/downloads.mjs', 'scripts');
    } else {
      copyRecursive('scripts', 'scripts');
    }
    // Remove legacy scripts that are no longer needed
    if (!opts.enableBundle) unlinkSafe(path.join(dstDir, 'scripts', 'esbuild.mjs'));
    if (pkgJson.private === true) unlinkSafe(path.join(dstDir, 'scripts', 'downloads.mjs'));
    unlinkSafe(path.join(dstDir, 'scripts', 'run-automator.mjs'));
    unlinkSafe(path.join(dstDir, 'scripts', 'runAutomator.mjs'));
    unlinkSafe(path.join(dstDir, 'scripts', 'prune-tags.sh'));
    unlinkSafe(path.join(dstDir, 'scripts', 'git-status.sh'));
    unlinkSafe(path.join(dstDir, 'scripts', 'mb-run.mjs'));
  }

  // Copy ignore files and configs
  if (!isWorkspace) {
    copyRecursive('.gitattributes', '.gitattributes');

    copyRecursive('.gitignore.txt', '.gitignore');
    appendFileToFileIfExists('.localignore', '.gitignore');
    appendFileToFileIfExists('.gitlocalignore', '.gitignore');

    copyRecursive('.oxlintrc.root.json', '.oxlintrc.json');
    copyRecursive('.oxfmtrc.root.json', '.oxfmtrc.json');
    unlinkSafe('.prettierignore');
    unlinkSafe('eslint.config.js');
    unlinkSafe('prettier.config.js');

    // Copy config files
    if (opts.enableJest) {
      copyRecursive('jest.config.js', 'jest.config.js');
      mkDirSafe(path.join(dstDir, 'test'));
    } else {
      log(magenta('No Jest flag set, removing Jest...'));
      if (!isMonorepo) unlinkSafe('tsconfig.jest.json');
      if (!isMonorepo) unlinkSafe('jest.config.js');
    }
    if (opts.enableVitest) {
      copyRecursive('vite.config.ts', 'vite.config.ts');
      mkDirSafe(path.join(dstDir, 'vitest'));
    } else {
      log(magenta('No Vitest flag set, removing Vitest...'));
      if (!isMonorepo) unlinkSafe('tsconfig.vitest.json');
      if (!isMonorepo) unlinkSafe('vite.config.ts');
    }
    if (opts.enableBuntest) {
      copyRecursive('bunfig.toml', 'bunfig.toml');
      mkDirSafe(path.join(dstDir, 'buntest'));
    } else {
      log(magenta('No Bun test flag set, removing Bun test...'));
      if (!isMonorepo) unlinkSafe('bunfig.toml');
    }
  }

  // Copy tsconfig files
  if (automator?.app !== true && automator?.skipTsconfig !== true) {
    unlinkSafe('tsconfig.production.json');
    unlinkSafe('tsconfig.vitest.json');
    if (!isWorkspace) copyRecursive('tsconfig.base.json', 'tsconfig.base.json');
    copyRecursive('tsconfig.json', 'tsconfig.json');
    copyRecursive('tsconfig.build.json', 'tsconfig.build.json');
    copyRecursive('tsconfig.build.production.json', 'tsconfig.build.production.json');
    if (opts.enableJest && !isWorkspace) copyRecursive('tsconfig.jest.json', 'tsconfig.jest.json');
    if (isMonorepo) {
      fileReplace(
        'tsconfig.json',
        '["src/**/*.ts", "test/**/*.ts", "vitest/**/*.ts"]',
        '["src/**/*.ts", "test/**/*.ts", "vitest/**/*.ts", "packages/*/src/**/*.ts", "packages/*/test/**/*.ts", "packages/*/vitest/**/*.ts"]',
      );
    } else {
      copyRecursive('tsconfig.build.json', 'tsconfig.build.json');
      copyRecursive(isLibrary ? 'tsconfig.build.production.library.json' : 'tsconfig.build.production.json', 'tsconfig.build.production.json');
      if (opts.useBun) {
        fileReplace('tsconfig.json', '["node"', '["node", "bun"');
        fileReplace('tsconfig.build.json', '["node"]', '["node", "bun"]');
        fileReplace('tsconfig.build.production.json', '["node"]', '["node", "bun"]');
      }
      if (isWorkspace) {
        fileReplace('tsconfig.json', '"extends": "./tsconfig.base.json"', '"extends": "../../tsconfig.base.json"');
        fileReplace('tsconfig.build.json', '"extends": "./tsconfig.base.json"', '"extends": "../../tsconfig.base.json"');
        fileReplace('tsconfig.build.production.json', '"extends": "./tsconfig.base.json"', '"extends": "../../tsconfig.base.json"');
        fileReplace('tsconfig.build.production.json', '"incremental": false,', '"incremental": true,');
        fileReplace('tsconfig.build.production.json', '"composite": false,', '"composite": true,');
        fileReplace('tsconfig.build.production.json', '"declaration": false,', '"declaration": true,');
        unlinkSafe('tsconfig.base.json');
      }
      if (!opts.enableJest) {
        log(magenta('No Jest flag set, removing Jest from tsconfig.json...'));
        fileReplace('tsconfig.json', `, "jest"`, ``);
        fileReplace('tsconfig.json', `, "test/**/*.ts"`, ``);
        fileReplace('tsconfig.json', `, "packages/*/test/**/*.ts"`, ``);
      }
      if (!opts.enableVitest) {
        log(magenta('No Vitest flag set, removing Vitest from tsconfig.json...'));
        fileReplace('tsconfig.json', ', "vitest/globals"', '');
        fileReplace('tsconfig.json', ', "vitest/**/*.ts"', '');
        fileReplace('tsconfig.json', ', "packages/*/vitest/**/*.ts"', '');
      }
    }
  }

  // Copy the docs
  if (!isWorkspace && automator?.private !== true) copyRecursive('CODE_OF_CONDUCT.md', 'CODE_OF_CONDUCT.md');
  if (!isWorkspace) copyRecursive('CODEOWNERS', 'CODEOWNERS');
  if (!isWorkspace && automator?.private !== true) copyRecursive('CONTRIBUTING.md', 'CONTRIBUTING.md');
  if (!(await fileExists('LICENSE')) && automator?.private !== true) copyRecursive('LICENSE', 'LICENSE');
  if (!isWorkspace) copyRecursive('STYLEGUIDE.md', 'STYLEGUIDE.md');

  // Add files to package
  if (!pkgJson.private && pkgJson.files === undefined) {
    if (isPlugin) {
      log(magenta('Package is a plugin, setting files...'));
      runSafe('npm pkg set "files[]=bin" "files[]=dist" "files[]=npm-shrinkwrap.json" "files[]=CHANGELOG.md" "files[]=*.config.json" "files[]=*.schema.json"');
    } else {
      log(magenta('Package is a library, setting files...'));
      runSafe('npm pkg set "files[]=bin" "files[]=dist" "files[]=npm-shrinkwrap.json" "files[]=CHANGELOG.md"');
    }
    await pressyAnyKey();
  }

  // Add keywords to plugin package
  if (isPlugin) {
    log(magenta('Package is a plugin, adding keywords...'));

    const desiredKeywords = [
      'matterbridge',
      'homebridge',
      'bridge',
      'childbridge',
      'plugin',
      'frontend',
      'matter.js',
      'matter-node.js',
      'matter',
      'matterprotocol',
      'iot',
      'smarthome',
      'connectedthings',
      'hap',
      'homekit',
      'siri',
      'google-home',
      'alexa',
      'homeassistant',
      'hass',
      'hassio',
      'gladysassistant',
      'smartthings',
      'ewelink',
    ];
    const originalKeywords = Array.isArray(pkgJson.keywords) ? pkgJson.keywords : typeof pkgJson.keywords === 'string' && pkgJson.keywords.trim() ? [pkgJson.keywords] : [];
    const existingKeywordSet = new Set(originalKeywords.map((keyword) => String(keyword).toLowerCase()));
    const keywordsToAdd = desiredKeywords.filter((keyword) => !existingKeywordSet.has(keyword.toLowerCase()));

    if (keywordsToAdd.length === 0) {
      log('All plugin keywords are already present, skipping keyword update.');
    } else {
      runSafe(`npm pkg set${keywordsToAdd.map((keyword) => ` "keywords[]=${keyword}"`).join('')}`);
    }
  }

  // Update package.json fields via npm pkg set
  const npmPkgSets = [];
  if (opts.useNode) npmPkgSets.push(['engines.node', '>=20.19.0 <21.0.0 || >=22.13.0 <23.0.0 || >=24.0.0 <25.0.0 || >=26.0.0 <27.0.0']);
  else if (opts.useBun) npmPkgSets.push(['engines.bun', '>=1.0.0']);
  if (!pkgJson.license) npmPkgSets.push(['license', 'Apache-2.0']);
  if (!pkgJson.type) npmPkgSets.push(['type', 'module']);
  if (!pkgJson.main) npmPkgSets.push(['main', 'dist/module.js']);
  if (!pkgJson.types) npmPkgSets.push(['types', 'dist/module.d.ts']);
  if (!pkgJson.author) npmPkgSets.push(['author', 'https://github.com/Luligu']);
  if (!pkgJson.repository) {
    npmPkgSets.push(['repository.type', 'git']);
    // oxlint-disable-next-line typescript/restrict-template-expressions
    npmPkgSets.push(['repository.url', `git+https://github.com/Luligu/${pkgJson.name}.git`]);
  }
  if (!pkgJson.funding) {
    npmPkgSets.push(['funding.type', 'buymeacoffee']);
    npmPkgSets.push(['funding.url', 'https://www.buymeacoffee.com/luligugithub']);
  }
  for (const [key, value] of npmPkgSets) {
    if (automator?.skipPackageJson !== true) runSafe(`npm pkg set "${key}=${value}"`);
  }

  // Remove old files that should not be in the package
  unlinkSafe('yellow-button.png');
  unlinkSafe('bmc-button.svg');
  unlinkSafe('matterbridge.svg');

  // Update image links in markdown files
  fileReplace('CHANGELOG.md', 'yellow-button.png', 'bmc-button.svg');
  fileReplace('README.md', 'yellow-button.png', 'bmc-button.svg');
  fileReplace('CHANGELOG.md', 'https://matterbridge.io/bmc-button.svg', 'https://matterbridge.io/assets/bmc-button.svg');
  fileReplace('CHANGELOG.md', 'src="matterbridge.svg"', 'src="https://matterbridge.io/assets/matterbridge.svg"');
  fileReplace('README.md', 'src="bmc-button.svg"', 'src="https://matterbridge.io/assets/bmc-button.svg"');
  fileReplace('README.md', 'src="./bmc-button.svg"', 'src="https://matterbridge.io/assets/bmc-button.svg"');
  fileReplace('CHANGELOG.md', 'src="bmc-button.svg"', 'src="https://matterbridge.io/assets/bmc-button.svg"');
  fileReplace('CHANGELOG.md', 'src="./bmc-button.svg"', 'src="https://matterbridge.io/assets/bmc-button.svg"');
  fileReplace('README.md', 'src="matterbridge.svg"', 'src="https://matterbridge.io/assets/matterbridge.svg"');
  fileReplace('README.md', 'https://matterbridge.io/bmc-button.svg', 'https://matterbridge.io/assets/bmc-button.svg');
  fileReplace('README.md', 'build-matterbridge-plugin.yml', 'build.yml');
  fileReplace('CHANGELOG.md', 'build-matterbridge-plugin.yml', 'build.yml');

  fileReplace(
    'README.md',
    '[![Docker Version](https://img.shields.io/docker/v/luligu/matterbridge?label=docker%20version&sort=semver)]',
    '[![Docker Version](https://img.shields.io/docker/v/luligu/matterbridge/latest?label=docker%20version)]',
  );
  fileReplace(
    'README.md',
    '[![Docker Pulls](https://img.shields.io/docker/pulls/luligu/matterbridge.svg)]',
    '[![Docker Pulls](https://img.shields.io/docker/pulls/luligu/matterbridge?label=docker%20pulls)]',
  );
  fileReplace(
    'CHANGELOG.md',
    '[![Docker Version](https://img.shields.io/docker/v/luligu/matterbridge?label=docker%20version&sort=semver)]',
    '[![Docker Version](https://img.shields.io/docker/v/luligu/matterbridge/latest?label=docker%20version)]',
  );
  fileReplace(
    'CHANGELOG.md',
    '[![Docker Pulls](https://img.shields.io/docker/pulls/luligu/matterbridge.svg)]',
    '[![Docker Pulls](https://img.shields.io/docker/pulls/luligu/matterbridge?label=docker%20pulls)]',
  );
  fileReplace('README.md', '[![power by]', '[![powered by]');
  fileReplace('CHANGELOG.md', '[![power by]', '[![powered by]');

  fileReplace('README.md', '(https://github.com/prettier/prettier)', '(https://prettier.io/)');
  fileReplace('README.md', '(https://github.com/eslint/eslint)', '(https://eslint.org/)');
  fileReplace('README.md', '(https://nodejs.org/api/esm.html)', '(https://nodejs.org/)');
  fileReplace('CHANGELOG.md', '(https://github.com/prettier/prettier)', '(https://prettier.io/)');
  fileReplace('CHANGELOG.md', '(https://github.com/eslint/eslint)', '(https://eslint.org/)');
  fileReplace('CHANGELOG.md', '(https://nodejs.org/api/esm.html)', '(https://nodejs.org/)');

  let updateScript = true;
  // Skip script setup for monorepos, as they may have different requirements and scripts for each package.
  if (isMonorepo) {
    log(magenta('Monorepo detected, skipping script setup for the root package.json.'));
    updateScript = false;
  }
  // Remove scripts for workspace packages.
  if (isWorkspace) {
    log(magenta('Package is a workspace, removing scripts...'));
    delete pkgJson.scripts;
    updateScript = false;
  }
  // Skip script setup when set.
  if (automator?.skipPackageJson === true) {
    log(magenta('SkipPackageJson detected, skipping script setup for the root package.json.'));
    updateScript = false;
  }
  // Skip script setup for apps, as they may have different requirements and scripts for each package.
  if (automator?.app === true) {
    log(magenta('App detected, skipping script setup for the root package.json.'));
    updateScript = false;
  }

  // Set scripts field.
  if (updateScript) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const scripts = pkgJson.scripts as Record<string, string> | undefined;
    // oxlint-disable-next-line typescript/no-base-to-string typescript/restrict-template-expressions
    const startScript = scripts?.start ?? `node ${pkgJson.main ?? 'dist/module.js'}`;
    log(magenta(`Start script: ${cyan(startScript)}`));

    let jestCoverageScript;
    let vitestCoverageScript;
    if (coverage?.lines === 100 && coverage.functions === 100 && coverage.statements === 100 && coverage.branches === 100) {
      jestCoverageScript =
        'cross-env NODE_OPTIONS="--experimental-vm-modules --no-warnings" jest --coverage --coverageThreshold="{ \\\"global\\\": {\\\"statements\\\": 100, \\\"branches\\\": 100, \\\"lines\\\": 100, \\\"functions\\\": 100 } }"';
    } else if (coverage?.lines === 100 && coverage.functions === 100) {
      jestCoverageScript =
        'cross-env NODE_OPTIONS="--experimental-vm-modules --no-warnings" jest --coverage --coverageThreshold="{ \\\"global\\\": { \\\"lines\\\": 100, \\\"functions\\\": 100 } }"';
    } else if (coverage?.lines === 100) {
      jestCoverageScript = 'cross-env NODE_OPTIONS="--experimental-vm-modules --no-warnings" jest --coverage --coverageThreshold="{ \\\"global\\\": { \\\"lines\\\": 100 } }"';
    } else {
      jestCoverageScript = 'cross-env NODE_OPTIONS="--experimental-vm-modules --no-warnings" jest --coverage';
    }
    if (opts.enableJest) {
      log(magenta(`Jest test coverage script: ${cyan(jestCoverageScript)}`));
    }

    if (coverage?.lines === 100 && coverage.functions === 100 && coverage.statements === 100 && coverage.branches === 100) {
      vitestCoverageScript =
        'vitest run --coverage --coverage.thresholds.statements=100 --coverage.thresholds.branches=100 --coverage.thresholds.lines=100 --coverage.thresholds.functions=100';
    } else if (coverage?.lines === 100 && coverage.functions === 100) {
      vitestCoverageScript = 'vitest run --coverage --coverage.thresholds.lines=100 --coverage.thresholds.functions=100';
    } else if (coverage?.lines === 100) {
      vitestCoverageScript = 'vitest run --coverage --coverage.thresholds.lines=100';
    } else {
      vitestCoverageScript = 'vitest run --coverage';
    }
    if (opts.enableVitest) {
      log(magenta(`Vitest test coverage script: ${cyan(vitestCoverageScript)}`));
    }

    pkgJson.scripts = {
      'start': isPlugin ? 'matterbridge' : startScript,
      'add': isPlugin ? 'matterbridge --add .' : undefined,
      'remove': isPlugin ? 'matterbridge --remove .' : undefined,
      'enable': isPlugin ? 'matterbridge --enable .' : undefined,
      'disable': isPlugin ? 'matterbridge --disable .' : undefined,
      'link': isPlugin ? 'npm link --no-fund --no-audit matterbridge' : undefined,
      'unlink': isPlugin ? 'npm unlink matterbridge' : undefined,
      'build': 'tsc --project tsconfig.build.json',
      'buildProduction': 'tsc --project tsconfig.build.production.json',
      'clean': 'node scripts/clean.mjs',
      'cleanBuild': 'npm run clean && npm run build',
      'cleanBuildProduction': 'npm run clean && npm run buildProduction',
      'deepClean': 'node scripts/deep-clean.mjs',
      'watch': 'tsc --project tsconfig.build.json --watch',
      'typecheck': 'tsc --project tsconfig.json --noEmit',
      'test': opts.enableJest && opts.enableVitest ? 'cross-env NODE_OPTIONS="--experimental-vm-modules --no-warnings" jest' : 'vitest run',
      'test:watch': opts.enableJest && opts.enableVitest ? 'cross-env NODE_OPTIONS="--experimental-vm-modules --no-warnings" jest --watch' : 'vitest watch',
      'test:verbose': opts.enableJest && opts.enableVitest ? 'cross-env NODE_OPTIONS="--experimental-vm-modules --no-warnings" jest --verbose' : 'vitest run --reporter verbose',
      'test:coverage': opts.enableJest && opts.enableVitest ? jestCoverageScript : vitestCoverageScript,
      'test:vitest': opts.enableJest && opts.enableVitest ? 'vitest run' : undefined,
      'test:vitest:watch': opts.enableJest && opts.enableVitest ? 'vitest watch' : undefined,
      'test:vitest:verbose': opts.enableJest && opts.enableVitest ? 'vitest run --reporter verbose' : undefined,
      'test:vitest:coverage': opts.enableJest && opts.enableVitest ? vitestCoverageScript : undefined,
      'lint': 'oxlint --disable-nested-config',
      'lint:fix': 'oxlint --disable-nested-config --fix',
      'format': 'oxfmt',
      'format:check': 'oxfmt --check',
      'preversion': automator?.version === true ? 'npm run runMeBeforePublish' : undefined,
      'postversion': automator?.version === true ? 'npm run build' : undefined,
      'version:patch': automator?.version === true ? 'npm version patch --no-git-tag-version' : undefined,
      'version:minor': automator?.version === true ? 'npm version minor --no-git-tag-version' : undefined,
      'version:major': automator?.version === true ? 'npm version major --no-git-tag-version' : undefined,
      'git:status': automator?.git === true ? 'git status && git branch -vv && git stash list && git fsck --full --no-reflogs' : undefined,
      'git:remote': automator?.git === true ? 'git remote -v && git remote show origin' : undefined,
      'git:prune': automator?.git === true ? 'git fetch --prune --prune-tags' : undefined,
      'git:hardreset:main': automator?.git === true ? 'git fetch origin && git checkout main && git reset --hard origin/main' : undefined,
      'git:hardreset:dev': automator?.git === true ? 'git fetch origin && git checkout dev && git reset --hard origin/dev' : undefined,
      'git:hardreset:edge': automator?.git === true ? 'git fetch origin && git checkout edge && git reset --hard origin/edge' : undefined,
      'git:rebase:dev': automator?.git === true ? 'git fetch origin && git checkout -b dev-backup && git checkout dev && git merge origin/main && git push origin dev' : undefined,
      'reset': 'npm run deepClean && npm run softReset',
      'softReset': `npm install --no-fund --no-audit && npm prune --no-fund --no-audit${isPlugin ? ' && npm link --no-fund --no-audit matterbridge' : ''} && npm run build && npm run typecheck`,
      'checkDependencies': `npm install --no-fund --no-audit --no-save npm-check-updates && ncu && npm run softReset`,
      'updateDependencies': `npm install --no-fund --no-audit --no-save npm-check-updates && ncu -u && npm run softReset`,
      'runMeBeforePublish':
        'npm run cleanBuild && npm run format && npm run lint && npm run build && npm run typecheck' +
        (opts.enableJest || opts.enableVitest ? ' && npm run test:coverage' : '') +
        (opts.enableJest && opts.enableVitest ? ' && npm run test:vitest:coverage' : ''),
      'prepublishOnly':
        'npm run cleanBuildProduction && npm pkg delete devDependencies scripts automator && node scripts/prepublish-clean.mjs && npm install --no-fund --no-audit --omit=dev && npm shrinkwrap --omit=dev',
      'npmPack':
        automator?.publish === true
          ? 'npx shx cp package.json package.json.backup && node scripts/version.mjs dev && npm run prepublishOnly && npm pack && npx shx cp package.json.backup package.json && npx shx rm -f package.json.backup && npm run reset'
          : undefined,
      'npmPublishTagDev':
        automator?.publish === true
          ? 'npx shx cp package.json package.json.backup && node scripts/version.mjs dev && npm run prepublishOnly && npm publish --tag dev && npx shx cp package.json.backup package.json && npx shx rm -f package.json.backup && npm run reset'
          : undefined,
      'npmPublishTagEdge':
        automator?.publish === true
          ? 'npx shx cp package.json package.json.backup && node scripts/version.mjs edge && npm run prepublishOnly && npm publish --tag edge && npx shx cp package.json.backup package.json && npx shx rm -f package.json.backup && npm run reset'
          : undefined,
      'npmPublishTagLatest':
        automator?.publish === true
          ? 'npx shx cp package.json package.json.backup && npm run prepublishOnly && npm publish --tag latest && npx shx cp package.json.backup package.json && npx shx rm -f package.json.backup && npm run reset'
          : undefined,
    };
  }

  // Set devDependencies field.
  const devDeps = pkgJson.devDependencies as Record<string, string> | undefined;
  delete devDeps?.['npm-check-updates'];
  delete devDeps?.['shx'];
  delete devDeps?.['cross-env'];
  delete devDeps?.['typescript'];
  delete devDeps?.['@types/node'];
  delete devDeps?.['@types/bun'];
  delete devDeps?.['@typescript/native-preview'];
  delete devDeps?.['oxlint'];
  delete devDeps?.['oxlint-tsgolint'];
  delete devDeps?.['oxfmt'];
  delete devDeps?.['eslint'];
  delete devDeps?.['@eslint/js'];
  delete devDeps?.['@eslint/json'];
  delete devDeps?.['@eslint/markdown'];
  delete devDeps?.['typescript-eslint'];
  delete devDeps?.['eslint-plugin-simple-import-sort'];
  delete devDeps?.['eslint-plugin-n'];
  delete devDeps?.['eslint-plugin-jsdoc'];
  delete devDeps?.['prettier'];
  delete devDeps?.['eslint-config-prettier'];
  delete devDeps?.['eslint-plugin-prettier'];
  delete devDeps?.['jest'];
  delete devDeps?.['ts-jest'];
  delete devDeps?.['@types/jest'];
  delete devDeps?.['@jest/globals'];
  delete devDeps?.['eslint-plugin-jest'];
  delete devDeps?.['vitest'];
  delete devDeps?.['@vitest/coverage-v8'];
  delete devDeps?.['@vitest/eslint-plugin'];
  delete devDeps?.['esbuild'];
  delete devDeps?.['javascript-obfuscator'];

  log(magenta(`Changing package.json "${pkgPath}" scripts and devDependencies...`));
  const packageJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
  writeFileSync(
    pkgPath,
    JSON.stringify(
      {
        ...packageJson,
        scripts: pkgJson.scripts,
        devDependencies: pkgJson.devDependencies,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  log(green('Installing devDependencies...'));
  const commands = [
    isWorkspace
      ? `npm install --no-fund --no-audit --save-dev --save-exact ${automator?.node ? '@types/node' : ''} ${automator?.bun ? '@types/bun' : ''} ${automator?.jestTypes ? '@types/jest' : ''} ${automator?.vitestTypes ? 'vitest' : ''}`
      : `npm install --no-fund --no-audit --save-dev --save-exact ${opts.useNode ? '@types/node' : ''} ${opts.useBun ? '@types/bun' : ''} ${automator?.jestTypes ? '@types/jest' : ''} ${automator?.vitestTypes ? 'vitest' : ''} typescript oxlint oxlint-tsgolint oxfmt`,
    opts.enableJest ? `npm install --no-fund --no-audit --save-dev --save-exact jest ts-jest @types/jest @jest/globals cross-env` : null,
    opts.enableVitest ? `npm install --no-fund --no-audit --save-dev --save-exact vitest @vitest/coverage-v8` : null,
    opts.enableBundle ? 'npm install --no-fund --no-audit --save-dev --save-exact esbuild' : null,
    opts.enableObfuscate ? `npm install --no-fund --no-audit --save-dev --save-exact javascript-obfuscator` : null,
    `npm prune --no-fund --no-audit`,
    isPlugin && !isWorkspace ? `npm link --no-fund --no-audit matterbridge` : null,
    isWorkspace ? null : `npm run format`,
    isWorkspace ? null : `npm run lint`,
    isWorkspace ? null : `npm run build`,
    isWorkspace ? null : `npm run typecheck`,
  ];
  for (const command of commands) {
    if (command) runSafe(command);
  }
}

/**
 *  Waits for the user to press any key, displaying an optional message before waiting for a key press.  This is useful for pausing execution to allow the user to read important information or warnings before proceeding.
 *
 * @param   {string} [msg] Optional message to display before waiting for a key press. Defaults to 'Press any key to continue or press Ctrl+C to abort...'.
 * @returns {Promise<void>} A promise that resolves when a key is pressed.
 */
export async function pressyAnyKey(msg: string = 'Press any key to continue or press Ctrl+C to abort...'): Promise<void> {
  if (msg) log(msg);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isTTY ? stdin.isRaw : undefined;

    const done = (): void => {
      stdin.off('data', done);
      try {
        if (stdin.isTTY) stdin.setRawMode(Boolean(wasRaw));
      } catch {
        // ignore
      }
      stdin.pause();
      resolve();
    };

    try {
      if (stdin.isTTY) stdin.setRawMode(true);
    } catch {
      // ignore
    }
    stdin.resume();
    stdin.once('data', done);
  });
}

/**
 * Recursively copies a file or directory from source to destination, creating directories as needed.
 * If the destination path ends with a slash or points to an existing directory, the source will be copied into that directory.
 *
 * @param {string} sourceFileName Relative path to the source file or directory from the srcDir.
 * @param {string} destinationFileName Relative path to the destination file or directory from the dstDir.
 * @throws {Error} If the source file does not exist or cannot be read, or if a file cannot be copied.
 */
export function copyRecursive(sourceFileName: string, destinationFileName: string): void {
  const sourcePath = path.join(srcDir, sourceFileName);
  let destinationPath = path.join(dstDir, destinationFileName);

  const stats = statSync(sourcePath);
  if (stats.isDirectory()) {
    mkdirSync(destinationPath, { recursive: true });
    const entries = readdirSync(sourcePath);
    for (const entry of entries) {
      copyRecursive(path.join(sourceFileName, entry), path.join(destinationFileName, entry));
    }
  } else {
    // If destinationPath points to a directory (or ends with a slash), copy into it.
    const destinationLooksLikeDir = destinationFileName.endsWith('/') || destinationFileName.endsWith('\\');
    if (destinationLooksLikeDir) {
      mkdirSync(destinationPath, { recursive: true });
      // oxlint-disable-next-line typescript/no-non-null-assertion
      destinationPath = path.join(destinationPath, sourceFileName.split('/').pop()!);
    } else if (existsSync(destinationPath) && statSync(destinationPath).isDirectory()) {
      // oxlint-disable-next-line typescript/no-non-null-assertion
      destinationPath = path.join(destinationPath, sourceFileName.split('/').pop()!);
    }

    mkdirSync(path.join(destinationPath, '..'), { recursive: true });
    copyFileSync(sourcePath, destinationPath);
    log(`${green('Copied:')} ${path.relative(process.cwd(), destinationPath)}`);
  }
}

/**
 * Resolves the given file path relative to the current dstDir if it's not already absolute.
 *
 * @param {string} filePath Relative or absolute file path to resolve.
 * @returns {string} Absolute file path resolved against dstDir if it was relative, or the original filePath if it was already absolute.
 */
export function resolveDstPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(dstDir, filePath);
}

/**
 * Creates the directory at the given path if it does not exist, logging the action. The path is resolved relative to the current dstDir.
 *
 * @param {string} dirPath Relative or absolute path to the directory to create.
 * @returns {boolean} True if the directory was created, false if it already existed.
 * @throws {Error} If the directory cannot be created.
 */
export function mkDirSafe(dirPath: string): boolean {
  const resolvedPath = resolveDstPath(dirPath);
  if (existsSync(resolvedPath)) return false;

  mkdirSync(resolvedPath, { recursive: true });
  log(`${green('Created:')} ${path.relative(process.cwd(), resolvedPath)}`);
  return true;
}

/**
 * Deletes the file at the given path if it exists, logging the action.  The path is resolved relative to the current dstDir.
 *
 * @param {string} filePath Relative or absolute path to the file to delete.
 * @returns {boolean} True if the file was deleted, false if it did not exist.
 * @throws {Error} If the file exists but cannot be deleted.
 */
export function unlinkSafe(filePath: string): boolean {
  const resolvedPath = resolveDstPath(filePath);
  if (!existsSync(resolvedPath)) return false;

  unlinkSync(resolvedPath);
  log(`${green('Deleted:')} ${path.relative(process.cwd(), resolvedPath)}`);
  return true;
}

/**
 * Deletes the directory at the given path if it exists, logging the action. The path is resolved relative to the current dstDir.
 *
 * @param {string} dirPath Relative or absolute path to the directory to delete.
 * @returns {boolean} True if the directory was deleted, false if it did not exist.
 * @throws {Error} If the directory exists but cannot be deleted.
 */
export function removeDirSafe(dirPath: string): boolean {
  const resolvedPath = resolveDstPath(dirPath);
  if (!existsSync(resolvedPath)) return false;

  rmSync(resolvedPath, { recursive: true, force: true });
  log(`${green('Deleted:')} ${path.relative(process.cwd(), resolvedPath)}`);
  return true;
}

/**
 *  Appends the content of the source file to the destination file if both files exist and the source file is not empty.  The paths are resolved relative to the current dstDir.  A newline is added between the existing content and the appended content if the source content does not already start with a newline.
 *
 * @param {string} sourceFileName Relative path to the source file from the srcDir.
 * @param {string} destinationFileName Relative path to the destination file from the srcDir.
 * @returns {void}
 */
export function appendFileToFileIfExists(sourceFileName: string, destinationFileName: string): void {
  const sourcePath = path.join(dstDir, sourceFileName);
  const destinationPath = path.join(dstDir, destinationFileName);

  if (!existsSync(sourcePath) || !existsSync(destinationPath)) return;

  const content = readFileSync(sourcePath, 'utf8');
  if (!content.trim()) return;

  const prefix = content.startsWith('\n') ? '' : '\n';
  appendFileSync(destinationPath, `${prefix}${content}`, 'utf8');
  log(`${green('Appended:')} ${sourceFileName} -> ${destinationFileName}`);
}

/**
 * Executes the given command in a child process with stdio inherited from the parent, logging the command.  If the command fails, logs the error but does not throw, allowing execution to continue.
 *
 * @param {string} command The command to execute.
 * @returns {boolean} True if the command executed successfully, false if it failed.
 */
export function runSafe(command: string): boolean {
  if (!command) return false;
  log(`${green('Executing:')} ${command}`);

  try {
    execSync(command, { stdio: 'inherit', cwd: dstDir });
    return true;
  } catch (error) {
    const message = getErrorMessage(error);
    const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : undefined;

    commandFailures.push({ command, status, message });
    log(`Command failed ${message}: ${command}`);
    return false;
  }
}

/**
 * Finds the first occurrence of the given string or regex in the haystack string at or after the specified start index, returning an object with the index, end index, and matched text if found, or null if not found.  If the needle is an empty string, null is returned to avoid infinite loops.
 *
 * @param {string} haystack The string to search within.
 * @param {string|RegExp} needle The string or regular expression to search for.
 * @param {number} [startIndex] The index in the haystack string to start searching from. Defaults to 0.
 * @returns {{ index: number, endIndex: number, text: string } | null} An object containing the index, end index, and matched text if found, or null if not found.
 */
export function findMatchAfter(haystack: string, needle: string | RegExp, startIndex: number = 0): { index: number; endIndex: number; text: string } | null {
  const regex = tryParseRegexString(needle);
  if (regex) {
    const globalRegex = regex.flags.includes('g') ? regex : new RegExp(regex.source, `${regex.flags}g`);
    globalRegex.lastIndex = startIndex;
    const match = globalRegex.exec(haystack);
    if (!match) return null;

    return {
      index: match.index,
      endIndex: match.index + match[0].length,
      text: match[0],
    };
  }

  const literal = String(needle);
  if (!literal) return null;

  const index = haystack.indexOf(literal, startIndex);
  if (index === -1) return null;

  return {
    index,
    endIndex: index + literal.length,
    text: literal,
  };
}

/**
 * Tries to parse the given value as a regular expression string in the format /pattern/flags, supporting escaped trailing slashes.  If the value is already a RegExp, it is returned as is.  If the value is not a string or does not match the expected regex format, null is returned.
 *
 * @param {string|RegExp} value The value to parse as a regular expression string.
 * @returns {RegExp|null} The parsed RegExp object, or null if parsing failed.
 */
export function tryParseRegexString(value: string | RegExp): RegExp | null {
  if (value instanceof RegExp) return value;
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/')) return null;

  // Parse strings like `/pattern/gi` (supports escaped trailing slash: `\/`)
  let lastSlash = -1;
  for (let index = value.length - 1; index > 0; index -= 1) {
    if (value[index] === '/' && value[index - 1] !== '\\') {
      lastSlash = index;
      break;
    }
  }
  if (lastSlash <= 1) return null;

  const pattern = value.slice(1, lastSlash);
  const flags = value.slice(lastSlash + 1);
  if (!/^[dgimsuvy]*$/.test(flags)) return null;
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/**
 * Counts the number of occurrences of the needle string in the haystack string.  If the needle is an empty string, returns 0 to avoid infinite loops.
 *
 * @param {string} haystack The string to search within.
 * @param {string} needle The string to search for.
 * @returns {number} The number of occurrences of the needle in the haystack.
 */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let startIndex = 0;
  for (;;) {
    const index = haystack.indexOf(needle, startIndex);
    if (index === -1) return count;
    count += 1;
    startIndex = index + needle.length;
  }
}

/**
 * Searches for the given string or regex in the specified file and replaces it with the provided replacement string, returning an object indicating whether the file was changed and how many replacements were made.  If the file does not exist, returns { changed: false, replacements: 0 }.  The file path is resolved relative to the current dstDir.
 *
 * @param {string} filePath Relative or absolute path to the file to search and replace in.
 * @param {string|RegExp} search The string or regular expression to search for.
 * @param {string} replace The string to replace matches with.
 * @param {object} [options] Optional settings.
 * @param {BufferEncoding} [options.encoding] The file encoding to use. Defaults to 'utf8'.
 * @param {boolean} [options.dryRun] If true, do not actually write changes to the file, but still return whether changes would have been made and how many replacements would have been made. Defaults to false.
 * @returns {{ changed: boolean; replacements: number }} An object indicating whether the file was changed and how many replacements were made.
 */
export function fileReplace(
  filePath: string,
  search: string | RegExp,
  replace: string,
  options: { encoding?: BufferEncoding; dryRun?: boolean } = {},
): { changed: boolean; replacements: number } {
  const { encoding = 'utf8', dryRun = false } = options;
  const resolvedPath = resolveDstPath(filePath);
  if (!existsSync(resolvedPath)) return { changed: false, replacements: 0 };

  const content = readFileSync(resolvedPath, encoding);
  const regex = tryParseRegexString(search);

  let nextContent;
  let replacements;

  if (regex) {
    const globalRegex = regex.flags.includes('g') ? regex : new RegExp(regex.source, `${regex.flags}g`);
    globalRegex.lastIndex = 0;
    const matchCount = [...content.matchAll(globalRegex)].length;
    replacements = regex.flags.includes('g') ? matchCount : Math.min(matchCount, 1);

    regex.lastIndex = 0;
    nextContent = content.replace(regex, replace);
  } else {
    const literal = String(search);
    replacements = countOccurrences(content, literal);
    nextContent = replacements > 0 ? content.replaceAll(literal, replace) : content;
  }

  const changed = nextContent !== content;
  if (changed && !dryRun) {
    writeFileSync(resolvedPath, nextContent, encoding);
    log(`${green('Replaced:')} ${path.relative(process.cwd(), resolvedPath)}`);
  }

  return { changed, replacements };
}

// Usage:
// fileReplaceFromTo('README.md', '<!-- start -->', '<!-- end -->', 'new block');
// fileReplaceFromTo('README.md', '/<!-- start -->/', '/<!-- end -->/', 'new block');
/**
 * Searches for the given "from" and "to" strings or regexes in the specified file and replaces the content between them with the provided replacement string, returning an object indicating whether the file was changed and how many replacements were made.  If either the "from" or "to" string/regex is not found, or if the file does not exist, returns { changed: false, replacements: 0 }.  The file path is resolved relative to the current dstDir.
 *
 * @param {string} filePath Relative or absolute path to the file to search and replace in.
 * @param {string|RegExp} from The string or regular expression to search for as the start boundary.
 * @param {string|RegExp} to The string or regular expression to search for as the end boundary.
 * @param {string} replace The string to replace the content between the boundaries with.
 * @param {object} [options] Optional settings.
 * @param {BufferEncoding} [options.encoding] The file encoding to use. Defaults to 'utf8'.
 * @param {boolean} [options.dryRun] If true, do not actually write changes to the file, but still return whether changes would have been made and how many replacements would have been made. Defaults to false.
 * @param {boolean} [options.includeBounds] If true, include the "from" and "to" boundaries in the replacement. Defaults to false.
 * @returns {{ changed: boolean; replacements: number }} An object indicating whether the file was changed and how many replacements were made.
 */
export function fileReplaceFromTo(
  filePath: string,
  from: string | RegExp,
  to: string | RegExp,
  replace: string,
  options: {
    encoding?: BufferEncoding;
    dryRun?: boolean;
    includeBounds?: boolean;
  } = {},
): { changed: boolean; replacements: number } {
  const { encoding = 'utf8', dryRun = false, includeBounds = false } = options;
  const resolvedPath = resolveDstPath(filePath);
  if (!existsSync(resolvedPath)) return { changed: false, replacements: 0 };

  const content = readFileSync(resolvedPath, encoding);
  const fromMatch = findMatchAfter(content, from);
  if (!fromMatch) return { changed: false, replacements: 0 };

  const toMatch = findMatchAfter(content, to, fromMatch.endIndex);
  if (!toMatch) return { changed: false, replacements: 0 };

  const replaceStart = includeBounds ? fromMatch.index : fromMatch.endIndex;
  const replaceEnd = includeBounds ? toMatch.endIndex : toMatch.index;
  /* v8 ignore next -- toMatch is always found at or after fromMatch.endIndex */
  if (replaceEnd < replaceStart) return { changed: false, replacements: 0 };

  const nextContent = `${content.slice(0, replaceStart)}${replace}${content.slice(replaceEnd)}`;
  const changed = nextContent !== content;

  if (changed && !dryRun) {
    writeFileSync(resolvedPath, nextContent, encoding);
    log(`${green('Replaced from/to:')} ${path.relative(process.cwd(), resolvedPath)}`);
  }

  return { changed, replacements: changed ? 1 : 0 };
}
