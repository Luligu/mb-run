/* v8 ignore file */
/**
 * @description This file contains upgrade utilities for the mb-run command.
 * @file upgrade.ts
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

import { execSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path/win32';
import url from 'node:url';

import { cyan, green, log, magenta } from './ansi.js';
import { resolveWorkspacePackageJsonPaths } from './cache.js';
import { emptyDir, fileExists } from './clean.js';
import { isLibrary, isMonorepo, isPlugin, parsePackageJson } from './helpers.js';

const configDirname = path.dirname(url.fileURLToPath(import.meta.url));
const srcDir = path.join(configDirname, '..', 'vendor', 'upgrade');
let dstDir: string;

/** Context shared by all update operations. */
export interface UpgradeOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** True when running on Windows. */
  isWindows: boolean;
  /** When true, log but skip command execution and file-system writes. */
  dryRun: boolean;
  /** When true, enable Jest tests. */
  enableJest: boolean;
  /** When true, enable Vitest tests. */
  enableVitest: boolean;
  /** When true, enable promise rules. */
  enablePromiseRules: boolean;
  /** When true, enable experimental features. */
  enableExperimental: boolean;
  /** When true, enable type-aware features. */
  enableTypeAware: boolean;
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
    await runPackageJsonUpgrade(opts, dstDir, pkgJson, false, true, false, false);
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
export async function runPackageJsonUpgrade(
  opts: UpgradeOptions,
  pkgPath: string,
  pkgJson: Record<string, unknown>,
  isMonorepo: boolean = false,
  isWorkspace: boolean = false,
  isPlugin: boolean = false,
  isLibrary: boolean = false,
): Promise<void> {
  log(`Upgrading dependencies in ${magenta(dstDir)} ${isMonorepo ? '(monorepo)' : isWorkspace ? '(workspace)' : isPlugin ? '(plugin)' : ''}...`);

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
  if (pkgJson.homepage === undefined) {
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
  if (pkgJson.main === undefined) {
    log(
      'No main field found in package.json. It is recommended to add a main field for better compatibility with modern bundlers and to explicitly define the entry point of your package. For example:\n\n"main": "dist/module.js"\n\nThis helps ensure that consumers of your package can correctly resolve the appropriate module format based on their environment.',
    );
    await pressyAnyKey();
  }
  if (pkgJson.types === undefined) {
    log(
      'No types field found in package.json. It is recommended to add a types field for better compatibility with TypeScript and to explicitly define the type definitions of your package. For example:\n\n"types": "dist/module.d.ts"\n\nThis helps ensure that consumers of your package can correctly resolve the appropriate type definitions based on their environment.',
    );
    await pressyAnyKey();
  }
  if (pkgJson.exports === undefined) {
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
  if (pkgJson.bugs === undefined) {
    log(
      'No bugs field found in package.json. It is recommended to add a bugs field for better compatibility with modern bundlers and to explicitly define the bugs of your package. For example:\n\n"bugs": {\n  "url": "https://github.com/your-username/your-repo/issues"\n}\n\nThis helps ensure that consumers of your package can correctly find the bugs based on their environment.',
    );
    await pressyAnyKey();
  }
  if (pkgJson.funding === undefined) {
    log(
      'No funding field found in package.json. It is recommended to add a funding field for better compatibility with modern bundlers and to explicitly define the funding of your package. For example:\n\n"funding": {\n  "url": "https://github.com/your-username/your-repo/funding"\n}\n\nThis helps ensure that consumers of your package can correctly find the funding based on their environment.',
    );
    await pressyAnyKey();
  }
  if (pkgJson.keywords === undefined) {
    log(
      'No keywords field found in package.json. It is recommended to add a keywords field for better compatibility with modern bundlers and to explicitly define the keywords of your package. For example:\n\n"keywords": ["keyword1", "keyword2"]\n\nThis helps ensure that consumers of your package can correctly find the keywords based on their environment.',
    );
    await pressyAnyKey();
  }
  if (pkgJson.engines === undefined) {
    log(
      'No engines field found in package.json. It is recommended to add an engines field for better compatibility with modern bundlers and to explicitly define the engines of your package. For example:\n\n"engines": {\n  "node": ">=14"\n}\n\nThis helps ensure that consumers of your package can correctly find the engines based on their environment.',
    );
    await pressyAnyKey();
  }
  if (pkgJson.workspaces && !isMonorepo) {
    log(
      'Warning: workspaces field found in package.json but --monorepo-root flag not set. If this is intentional, you can ignore this warning. If this is not intentional, you may want to remove the workspaces field from your package.json or run the automator script with the --monorepo-package flag if this is a monorepo package.',
    );
    await pressyAnyKey();
  }
  if (existsSync(path.join(dstDir, 'packages')) && !isMonorepo) {
    log(
      'Warning: packages directory found but --monorepo-root flag not set. If this is intentional, you can ignore this warning. If this is not intentional, you may want to remove the packages directory or run the automator script with the --monorepo-package flag if this is a monorepo package.',
    );
    await pressyAnyKey();
  }

  // Copy .claude
  if (!isWorkspace) {
    copyRecursive('.claude', '.claude');
    if (!isPlugin) removeDirSafe(path.join(dstDir, '.claude', 'rules', 'matterbridge'));
  }

  // Copy .devcontainer
  if (!isWorkspace) {
    if (isPlugin) copyRecursive('.devcontainer-plugin', '.devcontainer');
    else copyRecursive('.devcontainer', '.devcontainer');
  }

  // Copy .github
  if (!isWorkspace) {
    if (isPlugin) copyRecursive('.github-plugin', '.github');
    else copyRecursive('.github', '.github');
  }

  // Copy .vscode
  if (!isWorkspace) {
    mkdirSync(path.join(dstDir, '.vscode'), { recursive: true });
    copyRecursive('.vscode/settings.json', '.vscode/settings.json');
    if (!existsSync('.vscode/tasks.json')) copyRecursive('.vscode/tasks.json', '.vscode/tasks.json');
  }

  // Copy ignore files and configs
  if (!isWorkspace) {
    copyRecursive('.gitattributes', '.gitattributes');
    copyRecursive('.gitignore', '.gitignore');
    copyRecursive('.prettierignore', '.prettierignore');
    if (!pkgJson.private === true && pkgJson.files === undefined) copyRecursive('.npmignore', '.npmignore');

    // Append optional .localignore fragments
    appendFileToFileIfExists('.localignore', '.gitignore');
    appendFileToFileIfExists('.localignore', '.prettierignore');
    if (!pkgJson.private === true && pkgJson.files === undefined) appendFileToFileIfExists('.localignore', '.npmignore');

    // Append optional .gitlocalignore, .prettierlocalignore fragments
    appendFileToFileIfExists('.gitlocalignore', '.gitignore');
    appendFileToFileIfExists('.prettierlocalignore', '.prettierignore');
    if (!pkgJson.private === true && pkgJson.files === undefined) appendFileToFileIfExists('.npmlocalignore', '.npmignore');

    // Copy config files
    copyRecursive('eslint.config.js', 'eslint.config.js');
    copyRecursive('prettier.config.js', 'prettier.config.js');
    if (opts.enableJest) copyRecursive('jest.config.js', 'jest.config.js');
    if (opts.enableVitest) copyRecursive('vite.config.ts', 'vite.config.ts');
    if (!opts.enableJest) {
      log(`${magenta('No Jest flag set, removing Jest Eslint...')}`);
      fileReplace('eslint.config.js', `import jest from 'eslint-plugin-jest';\n`, ``);
      fileReplace('eslint.config.js', `name: 'Global Ignores',\n    ignores: [`, `name: 'Global Ignores',\n    ignores: [...jestTestFiles, `);
      fileReplaceFromTo('eslint.config.js', `{\n    name: 'Jest Test Files',`, `// Disable JSDoc rule in test files\n    },\n  },\n`, ``, { includeBounds: true });
      unlinkSafe('tsconfig.jest.json');
      unlinkSafe('jest.config.js');
      if (!opts.enableVitest) {
        runSafe('npm pkg set "scripts.runMeBeforePublish=npm run cleanBuild && npm run format && npm run lint && npm run build"');
      } else {
        runSafe(
          'npm pkg set "scripts.runMeBeforePublish=npm run cleanBuild && npm run format && npm run lint && npm run build && npm run test:typecheck && npm run test:coverage"',
        );
      }
    }
    if (!opts.enableVitest) {
      log(`${magenta('No Vitest flag set, removing Vitest Eslint...')}`);
      fileReplace('eslint.config.js', `import vitest from '@vitest/eslint-plugin';\n`, ``);
      fileReplace('eslint.config.js', `name: 'Global Ignores',\n    ignores: [`, `name: 'Global Ignores',\n    ignores: [...vitestTestFiles, `);
      fileReplaceFromTo('eslint.config.js', `{\n    name: 'Vitest Test Files',`, `// Disable JSDoc rule in test files\n    },\n  },\n`, ``, { includeBounds: true });
      unlinkSafe('tsconfig.vitest.json');
      unlinkSafe('vite.config.ts');
      if (!opts.enableJest) {
        runSafe('npm pkg set "scripts.runMeBeforePublish=npm run cleanBuild && npm run format && npm run lint && npm run build"');
      } else {
        runSafe(
          'npm pkg set "scripts.runMeBeforePublish=npm run cleanBuild && npm run format && npm run lint && npm run build && npm run test:typecheck && npm run test:coverage"',
        );
      }
    }
    if (opts.enablePromiseRules) {
      log(`${magenta('Enabling promise rules...')}`);
      fileReplace('eslint.config.js', `// '@typescript-eslint/no-floating-promises'`, `'@typescript-eslint/no-floating-promises'`);
      fileReplace('eslint.config.js', `// '@typescript-eslint/no-misused-promises'`, `'@typescript-eslint/no-misused-promises'`);
      fileReplace('eslint.config.js', `// '@typescript-eslint/await-thenable'`, `'@typescript-eslint/await-thenable'`);
      fileReplace('eslint.config.js', `// '@typescript-eslint/return-await'`, `'@typescript-eslint/return-await'`);
      fileReplace('eslint.config.js', `// '@typescript-eslint/only-throw-error'`, `'@typescript-eslint/only-throw-error'`);
      fileReplace('eslint.config.js', `// '@typescript-eslint/promise-function-async'`, `'@typescript-eslint/promise-function-async'`);
      fileReplace('eslint.config.js', `// '@typescript-eslint/require-await'`, `'@typescript-eslint/require-await'`);
    }
  }

  // Copy tsconfig files
  unlinkSafe('tsconfig.production.json');
  if (!isWorkspace) copyRecursive('tsconfig.base.json', 'tsconfig.base.json');
  copyRecursive('tsconfig.json', 'tsconfig.json');
  if (opts.enableJest && !isWorkspace) copyRecursive('tsconfig.jest.json', 'tsconfig.jest.json');
  if (opts.enableVitest && !isWorkspace) copyRecursive('tsconfig.vitest.json', 'tsconfig.vitest.json');
  if (isMonorepo) {
    fileReplace(
      'tsconfig.json',
      '["src/**/*.ts", "test/**/*.ts", "vitest/**/*.ts"]',
      '["src/**/*.ts", "test/**/*.ts", "vitest/**/*.ts", "packages/*/src/**/*.ts", "packages/*/test/**/*.ts", "packages/*/vitest/**/*.ts"]',
    );
  } else {
    copyRecursive('tsconfig.build.json', 'tsconfig.build.json');
    if (isLibrary) copyRecursive('tsconfig.build.production.library.json', 'tsconfig.build.production.json');
    else copyRecursive('tsconfig.build.production.json', 'tsconfig.build.production.json');
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
      log(`${magenta('No Jest flag set, removing Jest from tsconfig.json...')}`);
      fileReplace('tsconfig.json', `, "jest"`, ``);
      fileReplace('tsconfig.json', `, "test/**/*.ts"`, ``);
      fileReplace('tsconfig.json', `, "packages/*/test/**/*.ts"`, ``);
    }
    if (!opts.enableVitest) {
      log(`${magenta('No Vitest flag set, removing Vitest from tsconfig.json...')}`);
      fileReplace('tsconfig.json', ', "vitest/globals"', '');
      fileReplace('tsconfig.json', ', "vitest/**/*.ts"', '');
      fileReplace('tsconfig.json', ', "packages/*/vitest/**/*.ts"', '');
    }
  }

  // Copy the scripts
  mkdirSync(path.join(dstDir, 'scripts'), { recursive: true });
  unlinkSafe(path.join(dstDir, 'scripts', 'run-automator.mjs'));
  unlinkSafe(path.join(dstDir, 'scripts', 'runAutomator.mjs'));
  unlinkSafe(path.join(dstDir, 'scripts', 'prune-tags.sh'));
  unlinkSafe(path.join(dstDir, 'scripts', 'git-status.sh'));
  unlinkSafe(path.join(dstDir, 'scripts', 'mb-run.mjs'));
  unlinkSafe(path.join(dstDir, 'scripts', 'version.mjs'));
  if (!isWorkspace) {
    copyRecursive('create-release.mjs', 'scripts/create-release.mjs');
    copyRecursive('prune-tags.mjs', 'scripts/prune-tags.mjs');
    copyRecursive('prune-releases.mjs', 'scripts/prune-releases.mjs');
    copyRecursive('remove-workflows.mjs', 'scripts/remove-workflows.mjs');
    copyRecursive('git-status.mjs', 'scripts/git-status.mjs');
    if (!pkgJson.private === true) copyRecursive('downloads.mjs', 'scripts/downloads.mjs');
  }

  // Copy the docs
  if (!isLibrary) copyRecursive('CODE_OF_CONDUCT.md', 'CODE_OF_CONDUCT.md');
  if (!isWorkspace) copyRecursive('CODEOWNERS', 'CODEOWNERS');
  if (!isWorkspace) copyRecursive('CONTRIBUTING.md', 'CONTRIBUTING.md');
  if (!(await fileExists('LICENSE'))) copyRecursive('LICENSE', 'LICENSE');
  if (!isWorkspace) copyRecursive('STYLEGUIDE.md', 'STYLEGUIDE.md');

  // Add files to package
  if (!pkgJson.private === true && pkgJson.files === undefined) {
    if (isPlugin) {
      log(`${magenta('Package is a plugin, setting files...')}`);
      runSafe('npm pkg set "files[]=bin" "files[]=dist" "files[]=npm-shrinkwrap.json" "files[]=CHANGELOG.md" "files[]=*.config.json" "files[]=*.schema.json"');
    } else {
      log(`${magenta('Package is a library, setting files...')}`);
      runSafe('npm pkg set "files[]=bin" "files[]=dist" "files[]=npm-shrinkwrap.json" "files[]=CHANGELOG.md"');
    }
    await pressyAnyKey();
  }

  // Add keywords to plugin package
  if (isPlugin) {
    log(`${magenta('Package is a plugin, adding keywords...')}`);

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
  const npmPkgSets = [['engines.node', '>=20.19.0 <21.0.0 || >=22.13.0 <23.0.0 || >=24.0.0 <25.0.0 || >=26.0.0 <27.0.0']];
  if (!pkgJson.license) npmPkgSets.push(['license', 'Apache-2.0']);
  if (!pkgJson.type) npmPkgSets.push(['type', 'module']);
  if (!pkgJson.main) npmPkgSets.push(['main', 'dist/module.js']);
  if (!pkgJson.types) npmPkgSets.push(['types', 'dist/module.d.ts']);
  if (!pkgJson.author) npmPkgSets.push(['author', 'https://github.com/Luligu']);
  if (!pkgJson.repository) {
    npmPkgSets.push(['repository.type', 'git']);
    npmPkgSets.push(['repository.url', `git+https://github.com/Luligu/${pkgJson.name}.git`]);
  }
  if (!pkgJson.funding) {
    npmPkgSets.push(['funding.type', 'buymeacoffee']);
    npmPkgSets.push(['funding.url', 'https://www.buymeacoffee.com/luligugithub']);
  }
  for (const [key, value] of npmPkgSets) {
    runSafe(`npm pkg set "${key}=${value}"`);
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

  // Set scripts field.
  const scripts = pkgJson.scripts as Record<string, string> | undefined;
  const startScript = scripts?.start ?? `node ${pkgJson.main ?? 'dist/module.js'}`;
  log(`Start script: ${cyan(startScript)}`);
  let testScript;
  if (
    scripts?.['test:coverage'] &&
    scripts['test:coverage'].includes('statements') &&
    scripts['test:coverage'].includes('branches') &&
    scripts['test:coverage'].includes('lines') &&
    scripts['test:coverage'].includes('functions')
  ) {
    testScript =
      'cross-env NODE_OPTIONS="--experimental-vm-modules --no-warnings" jest --maxWorkers=100% --coverage --coverageThreshold="{ \\"global\\": {\\"statements\\": 100, \\"branches\\": 100, \\"lines\\": 100, \\"functions\\": 100 } }"';
  } else if (scripts?.['test:coverage'] && scripts['test:coverage'].includes('lines') && scripts['test:coverage'].includes('functions')) {
    testScript =
      'cross-env NODE_OPTIONS="--experimental-vm-modules --no-warnings" jest --maxWorkers=100% --coverage --coverageThreshold="{ \\"global\\": { \\"lines\\": 100, \\"functions\\": 100 } }"';
  } else if (scripts?.['test:coverage'] && scripts['test:coverage'].includes('lines')) {
    testScript = 'cross-env NODE_OPTIONS="--experimental-vm-modules --no-warnings" jest --maxWorkers=100% --coverage --coverageThreshold="{ \\"global\\": { \\"lines\\": 100 } }"';
  } else {
    testScript = 'cross-env NODE_OPTIONS="--experimental-vm-modules --no-warnings" jest --maxWorkers=100% --coverage';
  }
  log(`Test coverage script: ${cyan(testScript)}`);
  const automator = scripts?.['automator'];
  pkgJson.scripts = {
    'start': startScript,
    'build': 'tsc --project tsconfig.build.json',
    'buildProduction': 'tsc --project tsconfig.build.production.json',
    'clean': 'npx shx rm -rf *.tsbuildinfo dist',
    'cleanBuild': 'npm run clean && npm run build',
    'cleanBuildProduction': 'npm run clean && npm run buildProduction',
    'deepClean':
      'npm run clean && npx shx rm -rf coverage jest temp package-lock.json npm-shrinkwrap.json .cache/* .cache/.[!.]* .cache/..?* node_modules/* node_modules/.[!.]* node_modules/..?*',
    'watch': 'tsc --project tsconfig.build.json --watch',
    'typecheck': 'tsc --project tsconfig.json --noEmit',
    'test': 'cross-env NODE_OPTIONS="--experimental-vm-modules --no-warnings" jest --maxWorkers=100%',
    'test:watch': 'cross-env NODE_OPTIONS="--experimental-vm-modules --no-warnings" jest --maxWorkers=100% --watch',
    'test:verbose': 'cross-env NODE_OPTIONS="--experimental-vm-modules --no-warnings" jest --maxWorkers=100% --verbose',
    'test:coverage': testScript,
    'test:typecheck': 'tsc --project tsconfig.jest.json --isolatedModules false --noEmit',
    'test:debug': 'node --no-warnings --experimental-vm-modules node_modules/jest/bin/jest.js',
    'test:vitest': 'vitest run',
    'test:vitest:watch': 'vitest --reporter verbose',
    'test:vitest:verbose': 'vitest run --reporter verbose',
    'test:vitest:coverage': 'vitest run --reporter verbose --coverage',
    'test:vitest:typecheck': 'tsc --project tsconfig.vitest.json --isolatedModules false --noEmit',
    'lint': 'eslint --cache --cache-location .cache/.eslintcache --max-warnings=0 .',
    'lint:fix': 'eslint --cache --cache-location .cache/.eslintcache --fix --max-warnings=0 .',
    'lint:debug': 'eslint --cache --cache-location .cache/.eslintcache --max-warnings=0 --debug',
    'lint:config': 'eslint --cache --cache-location .cache/.eslintcache --max-warnings=0 --print-config',
    'lint:inspect': 'eslint --cache --cache-location .cache/.eslintcache --max-warnings=0 --inspect-config',
    'format': 'prettier --cache --cache-location .cache/.prettiercache --write .',
    'format:check': 'prettier --cache --cache-location .cache/.prettiercache --check .',
    'preversion': 'npm run runMeBeforePublish',
    'postversion': 'npm run build',
    'version:patch': 'npm version patch --no-git-tag-version',
    'version:minor': 'npm version minor --no-git-tag-version',
    'version:major': 'npm version major --no-git-tag-version',
    'git:status': 'git status && git branch -vv && git stash list && git fsck --full --no-reflogs',
    'git:remote': 'git remote -v && git remote show origin',
    'git:prune': 'git fetch --prune --prune-tags',
    'git:hardreset:main': 'git fetch origin && git checkout main && git reset --hard origin/main',
    'git:hardreset:dev': 'git fetch origin && git checkout dev && git reset --hard origin/dev',
    'git:hardreset:edge': 'git fetch origin && git checkout edge && git reset --hard origin/edge',
    'reset': 'npm run deepClean && npm install --no-fund --no-audit && npm run build',
    'softReset': 'npm install --no-fund --no-audit && npm run build',
    'checkDependencies': 'npx npm-check-updates',
    'updateDependencies': 'npx npm-check-updates -u && npm run reset',
    'automator': automator ? automator : 'node scripts/run-automator.mjs',
    'runMeBeforePublish': 'npm run cleanBuild && npm run format && npm run lint && npm run test:typecheck && npm run test:coverage && npm run build',
    'prepublishOnly':
      'npm run cleanBuildProduction && npm pkg delete devDependencies scripts && npx shx rm -rf node_modules/* node_modules/.[!.]* node_modules/..?* package-lock.json npm-shrinkwrap.json && npm install --omit=dev && npm shrinkwrap --omit=dev',
    'npmPack':
      'npx shx cp package.json package.json.backup && node scripts/version.mjs dev && npm run prepublishOnly && npm pack && npx shx cp package.json.backup package.json && npx shx rm -f package.json.backup && npm run reset',
    'npmPublishTagDev':
      'npx shx cp package.json package.json.backup && node scripts/version.mjs dev && npm run prepublishOnly && npm publish --tag dev && npx shx cp package.json.backup package.json && npx shx rm -f package.json.backup && npm run reset',
    'npmPublishTagEdge':
      'npx shx cp package.json package.json.backup && node scripts/version.mjs edge && npm run prepublishOnly && npm publish --tag edge && npx shx cp package.json.backup package.json && npx shx rm -f package.json.backup && npm run reset',
    'npmPublishTagLatest':
      'npx shx cp package.json package.json.backup && npm run prepublishOnly && npm publish --tag latest && npx shx cp package.json.backup package.json && npx shx rm -f package.json.backup && npm run reset',
  };
  if (isPlugin) {
    log(`${magenta('Package is a plugin, setting additional scripts...')}`);
    (pkgJson.scripts as Record<string, string>)['start'] = 'matterbridge';
    (pkgJson.scripts as Record<string, string>)['reset'] = 'npm run deepClean && npm install --no-fund --no-audit && npm link --no-fund --no-audit matterbridge && npm run build';
    (pkgJson.scripts as Record<string, string>)['softReset'] = 'npm install --no-fund --no-audit && npm link --no-fund --no-audit matterbridge && npm run build';
    (pkgJson.scripts as Record<string, string>)['dev:link'] = 'npm link --no-fund --no-audit matterbridge';
    (pkgJson.scripts as Record<string, string>)['matterbridge:add'] = 'matterbridge -add .';
    (pkgJson.scripts as Record<string, string>)['matterbridge:remove'] = 'matterbridge -remove .';
    (pkgJson.scripts as Record<string, string>)['matterbridge:enable'] = 'matterbridge -enable .';
    (pkgJson.scripts as Record<string, string>)['matterbridge:disable'] = 'matterbridge -disable .';
    (pkgJson.scripts as Record<string, string>)['matterbridge:list'] = 'matterbridge -list';
  }
  if (isLibrary) {
    log(`${magenta('Package is a library, setting additional scripts...')}`);
  }
  if (isWorkspace) {
    log(`${magenta('Package is a monorepo package, removing scripts...')}`);
    delete pkgJson.scripts;
  }
  if (!opts.enableJest && !opts.enableVitest) {
    log(`${magenta('No Jest flag set, removing Jest scripts...')}`);
    delete (pkgJson.scripts as Record<string, string>)['test'];
    delete (pkgJson.scripts as Record<string, string>)['test:watch'];
    delete (pkgJson.scripts as Record<string, string>)['test:verbose'];
    delete (pkgJson.scripts as Record<string, string>)['test:coverage'];
    delete (pkgJson.scripts as Record<string, string>)['test:typecheck'];
    delete (pkgJson.scripts as Record<string, string>)['test:debug'];
  }
  if (!opts.enableJest && opts.enableVitest) {
    log(`${magenta('No Jest flag set, removing Jest scripts...')}`);
    (pkgJson.scripts as Record<string, string>)['test'] = (pkgJson.scripts as Record<string, string>)['test:vitest'];
    (pkgJson.scripts as Record<string, string>)['test:watch'] = (pkgJson.scripts as Record<string, string>)['test:vitest:watch'];
    (pkgJson.scripts as Record<string, string>)['test:verbose'] = (pkgJson.scripts as Record<string, string>)['test:vitest:verbose'];
    (pkgJson.scripts as Record<string, string>)['test:coverage'] = (pkgJson.scripts as Record<string, string>)['test:vitest:coverage'];
    (pkgJson.scripts as Record<string, string>)['test:typecheck'] = (pkgJson.scripts as Record<string, string>)['test:vitest:typecheck'];
    delete (pkgJson.scripts as Record<string, string>)['test:debug'];
    delete (pkgJson.scripts as Record<string, string>)['test:vitest'];
    delete (pkgJson.scripts as Record<string, string>)['test:vitest:watch'];
    delete (pkgJson.scripts as Record<string, string>)['test:vitest:verbose'];
    delete (pkgJson.scripts as Record<string, string>)['test:vitest:coverage'];
    delete (pkgJson.scripts as Record<string, string>)['test:vitest:typecheck'];
  }
  if (!opts.enableVitest) {
    log(`${magenta('No Vitest flag set, removing Vitest scripts...')}`);
    delete (pkgJson.scripts as Record<string, string>)['test:vitest'];
    delete (pkgJson.scripts as Record<string, string>)['test:vitest:watch'];
    delete (pkgJson.scripts as Record<string, string>)['test:vitest:verbose'];
    delete (pkgJson.scripts as Record<string, string>)['test:vitest:coverage'];
    delete (pkgJson.scripts as Record<string, string>)['test:vitest:typecheck'];
  }

  // Set devDependencies field.
  const devDeps = pkgJson.devDependencies as Record<string, string> | undefined;
  delete devDeps?.['npm-check-updates'];
  delete devDeps?.['shx'];
  delete devDeps?.['cross-env'];
  delete devDeps?.['typescript'];
  delete devDeps?.['@types/node'];
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

  const packageJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
  writeFileSync(pkgPath, JSON.stringify({ ...packageJson, scripts: pkgJson.scripts, devDependencies: pkgJson.devDependencies }, null, 2) + '\n', 'utf8');

  await emptyDir('node_modules', { rootDir: dstDir, dryRun: false });
  log(`${green('Installing devDependencies...')}`);
  const commands = [
    `npm install --no-fund --no-audit --save-dev --save-exact npm-check-updates shx cross-env`,
    `npm pkg delete overrides.typescript overrides.eslint overrides.@eslint/js`,
    `npm pkg delete overrides`,
    `npm install --no-fund --no-audit --save-dev --save-exact typescript @types/node`,
    `npm install --no-fund --no-audit --save-dev --save-exact eslint@latest @eslint/js@latest @eslint/json@latest @eslint/markdown@latest`,
    `npm install --no-fund --no-audit --save-dev --save-exact typescript-eslint eslint-plugin-simple-import-sort eslint-plugin-n eslint-plugin-jsdoc`,
    `npm install --no-fund --no-audit --save-dev --save-exact prettier eslint-config-prettier eslint-plugin-prettier`,
    opts.enableJest ? `npm install --no-fund --no-audit --save-dev --save-exact jest ts-jest @types/jest @jest/globals eslint-plugin-jest` : null,
    opts.enableVitest ? `npm install --no-fund --no-audit --save-dev --save-exact vitest @vitest/coverage-v8 @vitest/eslint-plugin` : null,
    opts.enableBundle ? 'npm install --no-fund --no-audit --save-dev --save-exact esbuild' : null,
    opts.enableObfuscate ? 'npm install --no-fund --no-audit --save-dev --save-exact javascript-obfuscator' : null,
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
function pressyAnyKey(msg: string = 'Press any key to continue or press Ctrl+C to abort...'): Promise<void> {
  if (msg) log(msg);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isTTY ? stdin.isRaw : undefined;

    const done = () => {
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
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      destinationPath = path.join(destinationPath, sourceFileName.split('/').pop()!);
    } else if (existsSync(destinationPath) && statSync(destinationPath).isDirectory()) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
function resolveDstPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(dstDir, filePath);
}

/**
 * Deletes the file at the given path if it exists, logging the action.  The path is resolved relative to the current dstDir.
 *
 * @param {string} filePath Relative or absolute path to the file to delete.
 * @returns {boolean} True if the file was deleted, false if it did not exist.
 * @throws {Error} If the file exists but cannot be deleted.
 */
function unlinkSafe(filePath: string): boolean {
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
function removeDirSafe(dirPath: string): boolean {
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
function appendFileToFileIfExists(sourceFileName: string, destinationFileName: string): void {
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
function runSafe(command: string): boolean {
  if (!command) return false;
  log(`${green('Executing:')} ${command}`);

  try {
    execSync(command, { stdio: 'inherit', cwd: dstDir });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // commandFailures.push({ command, status, message });
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
function findMatchAfter(haystack: string, needle: string | RegExp, startIndex: number = 0): { index: number; endIndex: number; text: string } | null {
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
function tryParseRegexString(value: string | RegExp): RegExp | null {
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
function countOccurrences(haystack: string, needle: string): number {
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
function fileReplace(
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
    nextContent = replacements > 0 ? content.replaceAll(literal, String(replace)) : content;
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
function fileReplaceFromTo(
  filePath: string,
  from: string | RegExp,
  to: string | RegExp,
  replace: string,
  options: { encoding?: BufferEncoding; dryRun?: boolean; includeBounds?: boolean } = {},
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
  if (replaceEnd < replaceStart) return { changed: false, replacements: 0 };

  const nextContent = `${content.slice(0, replaceStart)}${String(replace)}${content.slice(replaceEnd)}`;
  const changed = nextContent !== content;

  if (changed && !dryRun) {
    writeFileSync(resolvedPath, nextContent, encoding);
    log(`${green('Replaced from/to:')} ${path.relative(process.cwd(), resolvedPath)}`);
  }

  return { changed, replacements: changed ? 1 : 0 };
}
