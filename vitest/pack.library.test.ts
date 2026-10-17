/**
 * @file vitest/pack.library.test.ts
 * @description End-to-end tests that run the real pack workflow (TypeScript 7, esbuild, rollup-plugin-dts, oxfmt and npm, nothing mocked) on realistic single-package and monorepo libraries, then install the produced tarball into a fresh consumer that type-checks and runs it.
 * @author Luca Liguori
 */

import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { runWorkspaceTypecheck } from '../src/build.js';
import { initLogger } from '../src/logger.js';
import { runPack } from '../src/pack.js';
import { runCommand } from '../src/spawn.js';
import {
  consumerRuntimeScript,
  createConsumer,
  createMonorepoFixture,
  createSinglePackageFixture,
  expectedRuntimeResult,
  findDeclarationProblems,
  linkInstalledPackages,
  isWindows,
  listFiles,
  MONOREPO_NAME,
  runNode,
  SINGLE_NAME,
} from './fixtures/library.js';

/** Packing runs two full TypeScript builds, esbuild, npm and oxfmt. */
const PACK_TIMEOUT = 180_000;

let tmpDir: string;
let rootDir: string;
let consumerDir: string;
let previousPreferOffline: string | undefined;

describe('pack (real tools, realistic fixtures)', () => {
  beforeAll(() => {
    // Resolve cross-spawn from the npm cache when possible; the registry is only a fallback.
    previousPreferOffline = process.env['npm_config_prefer_offline'];
    process.env['npm_config_prefer_offline'] = 'true';
  });

  afterAll(() => {
    if (previousPreferOffline === undefined) delete process.env['npm_config_prefer_offline'];
    else process.env['npm_config_prefer_offline'] = previousPreferOffline;
  });

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    initLogger({ dryRun: false, verbose: false, rootDir: '' });
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-pack-fixture-'));
    rootDir = path.join(tmpDir, 'library');
    consumerDir = path.join(tmpDir, 'consumer');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Runs the real pack workflow and extracts the produced tarball.
   *
   * @param {string} packageName Library package name.
   * @param {boolean} obfuscate Whether to obfuscate the bundled JavaScript.
   * @returns {Promise<string>} The extracted package directory (the tarball's `package/` folder).
   */
  async function packAndExtract(packageName: string, obfuscate: boolean): Promise<string> {
    // mb-run always runs from the project root (its rootDir is process.cwd()); the formatter step relies on it.
    const previousCwd = process.cwd();
    process.chdir(rootDir);
    try {
      await runPack({ rootDir, isWindows, dryRun: false, obfuscate });
    } finally {
      process.chdir(previousCwd);
    }

    const extractDir = path.join(tmpDir, 'extracted');
    await mkdir(extractDir, { recursive: true });
    // Relative paths keep both GNU tar and the bsdtar shipped with Windows happy.
    const tar = spawnSync('tar', ['-xzf', path.join('..', 'library', `${packageName}-1.0.0.tgz`)], { cwd: extractDir, encoding: 'utf8' });
    expect(tar.stderr).toBe('');
    expect(tar.status).toBe(0);
    return path.join(extractDir, 'package');
  }

  /**
   * Asserts that every shipped JavaScript file is obfuscated, or that none is.
   *
   * @param {string} packageDir Extracted package directory.
   * @param {boolean} obfuscate Whether the package was packed with obfuscation.
   * @returns {Promise<void>} Resolves when every file is checked.
   */
  async function expectObfuscated(packageDir: string, obfuscate: boolean): Promise<void> {
    const javascriptFiles = (await listFiles(packageDir)).filter((file) => file.endsWith('.js'));
    const obfuscatedFiles: string[] = [];
    for (const file of javascriptFiles) {
      if (/_0x[0-9a-f]+/.test(await readFile(path.join(packageDir, file), 'utf8'))) obfuscatedFiles.push(file);
    }
    expect(obfuscatedFiles).toEqual(obfuscate ? javascriptFiles : []);
  }

  /**
   * Lists shrinkwrap entries a user's `npm install` could not reproduce: links, entries outside
   * `node_modules/` (workspace folders, paths on the packing machine) and entries without a
   * registry tarball.
   *
   * @param {Record<string, unknown>} shrinkwrap Parsed `npm-shrinkwrap.json`.
   * @returns {string[]} One message per problem.
   */
  function findShrinkwrapProblems(shrinkwrap: Record<string, unknown>): string[] {
    const problems: string[] = [];
    for (const [name, entry] of Object.entries(shrinkwrap['packages'] as Record<string, { link?: boolean; extraneous?: boolean; resolved?: string }>)) {
      if (name === '') continue;
      if (entry.link === true) problems.push(`${name}: link`);
      if (entry.extraneous === true) problems.push(`${name}: extraneous`);
      if (!name.startsWith('node_modules/')) problems.push(`${name}: outside node_modules`);
      if (!entry.resolved?.startsWith('https://')) problems.push(`${name}: resolved ${entry.resolved}`);
    }
    return problems;
  }

  /**
   * Reads and parses a JSON file.
   *
   * @param {string} filePath JSON file path.
   * @returns {Promise<Record<string, unknown>>} The parsed object.
   */
  async function readJson(filePath: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
  }

  /**
   * Installs the tarball into a fresh consumer with a real `npm install`, which reads the shipped
   * `npm-shrinkwrap.json`, then type-checks the consumer, runs it and runs the bin.
   *
   * @param {string} packageDir Extracted package directory.
   * @param {string} packageName Library package name.
   * @param {string | null} utilsSubpath Subpath export of the utilities, or null when the library has none.
   * @param {string | null} [devicesSubpath] Subpath export of the Greeter subclass, or null when the library has none.
   * @returns {Promise<void>} Resolves when every consumer check passed.
   */
  async function expectConsumable(packageDir: string, packageName: string, utilsSubpath: string | null, devicesSubpath: string | null = null): Promise<void> {
    await createConsumer(consumerDir, packageName, utilsSubpath, devicesSubpath);
    await runCommand('npm', ['install', path.join(rootDir, `${packageName}-1.0.0.tgz`), '--no-fund', '--no-audit', '--silent'], { cwd: consumerDir });
    // npm prunes packages it did not install, so the TypeScript toolchain is linked afterwards.
    await linkInstalledPackages(consumerDir, ['typescript', '@types/node']);
    const installedDir = path.join(consumerDir, 'node_modules', packageName);
    // npm installed real copies from the registry or its cache (no link back to the developer's machine) and no workspace package.
    for (const runtimeDependency of ['cross-spawn', 'path-key']) {
      expect((await lstat(path.join(consumerDir, 'node_modules', runtimeDependency))).isSymbolicLink()).toBe(false);
    }
    expect((await readdir(path.join(consumerDir, 'node_modules'))).filter((name) => name === '@fixture')).toEqual([]);
    expect(await readFile(path.join(installedDir, 'package.json'), 'utf8')).toBe(await readFile(path.join(packageDir, 'package.json'), 'utf8'));

    await runWorkspaceTypecheck({ rootDir: consumerDir, isWindows, dryRun: false, mode: 'build', watch: false });

    const runtime = runNode(['--input-type=module', '-e', consumerRuntimeScript(packageName, utilsSubpath, devicesSubpath)], consumerDir);
    expect(runtime.stderr).toBe('');
    expect(runtime.status).toBe(0);
    expect(JSON.parse(runtime.stdout)).toEqual(expectedRuntimeResult(devicesSubpath !== null));

    // Run the bin through the path the published package.json declares, as npm links it.
    const installedPackage = await readJson(path.join(installedDir, 'package.json'));
    const bin = installedPackage['bin'] as Record<string, string>;
    const cli = runNode([path.join(installedDir, ...bin[packageName].split('/'))], consumerDir);
    expect(cli.stderr).toBe('');
    expect(cli.status).toBe(0);
    expect(cli.stdout).toMatch(new RegExp(`^${packageName} Hello, Cli! node v\\d+`));
  }

  it.each([false, true])(
    'should pack a single-package library into a tarball that a consumer can type-check, run and execute (obfuscate=%s)',
    async (obfuscate) => {
      await createSinglePackageFixture(rootDir);
      const originalPackageJson = await readFile(path.join(rootDir, 'package.json'), 'utf8');

      const packageDir = await packAndExtract(SINGLE_NAME, obfuscate);
      await expectObfuscated(packageDir, obfuscate);

      const packedPackage = await readJson(path.join(packageDir, 'package.json'));
      expect(packedPackage['devDependencies']).toBeUndefined();
      expect(packedPackage['scripts']).toBeUndefined();
      expect(packedPackage['dependencies']).toEqual({ 'cross-spawn': '7.0.6' });
      expect(packedPackage['types']).toBe('dist/module.d.ts');
      expect(packedPackage['bin']).toEqual({ [SINGLE_NAME]: 'dist/bin/cli.js' });

      const shrinkwrap = await readJson(path.join(packageDir, 'npm-shrinkwrap.json'));
      const lockedPackages = shrinkwrap['packages'] as Record<string, { dev?: boolean }>;
      expect(Object.keys(lockedPackages)).toContain('node_modules/cross-spawn');
      expect(Object.values(lockedPackages).filter((lockedPackage) => lockedPackage.dev === true)).toEqual([]);
      expect(findShrinkwrapProblems(shrinkwrap)).toEqual([]);

      const packedFiles = await listFiles(packageDir);
      expect(packedFiles).toContain('dist/module.js');
      expect(packedFiles).toContain('dist/module.d.ts');
      expect(packedFiles).toContain('dist/bin/cli.js');
      // Only dist, package.json and the shrinkwrap ship: the source launcher in bin/ is excluded.
      expect(packedFiles.filter((file) => !file.startsWith('dist/'))).toEqual(['npm-shrinkwrap.json', 'package.json']);
      expect(packedFiles.filter((file) => file.endsWith('.d.ts'))).toEqual(['dist/module.d.ts']);
      expect(packedFiles.filter((file) => file.endsWith('.map') || file.endsWith('.tsbuildinfo'))).toEqual([]);
      expect(await findDeclarationProblems(packageDir, ['dist/module.d.ts'])).toEqual([]);

      await expectConsumable(packageDir, SINGLE_NAME, null);

      // The workspace is restored and rebuilt for development.
      expect(await readFile(path.join(rootDir, 'package.json'), 'utf8')).toBe(originalPackageJson);
      const devDistFiles = await listFiles(path.join(rootDir, 'dist'));
      expect(devDistFiles).toContain('greeter.js');
      expect(devDistFiles).toContain('greeter.d.ts.map');
    },
    PACK_TIMEOUT,
  );

  it.each([false, true])(
    'should pack a monorepo library into a tarball without workspace packages that a consumer can type-check, run and execute (obfuscate=%s)',
    async (obfuscate) => {
      await createMonorepoFixture(rootDir);
      const originalPackageJson = await readFile(path.join(rootDir, 'package.json'), 'utf8');

      const packageDir = await packAndExtract(MONOREPO_NAME, obfuscate);
      await expectObfuscated(packageDir, obfuscate);

      const packedPackage = await readJson(path.join(packageDir, 'package.json'));
      expect(packedPackage['devDependencies']).toBeUndefined();
      expect(packedPackage['scripts']).toBeUndefined();
      expect(packedPackage['workspaces']).toBeUndefined();
      // Workspace packages are inlined; their runtime dependencies are hoisted to the root.
      expect(packedPackage['dependencies']).toEqual({ 'cross-spawn': '7.0.6' });
      expect(packedPackage['types']).toBe('dist/export.d.ts');
      expect(packedPackage['bin']).toEqual({ [MONOREPO_NAME]: 'dist/bin/cli.js' });

      const shrinkwrap = await readJson(path.join(packageDir, 'npm-shrinkwrap.json'));
      const lockedNames = Object.keys(shrinkwrap['packages'] as Record<string, unknown>);
      expect(lockedNames).toContain('node_modules/cross-spawn');
      expect(lockedNames.filter((name) => name.includes('@fixture/') || name.startsWith('packages/'))).toEqual([]);
      expect(findShrinkwrapProblems(shrinkwrap)).toEqual([]);

      const packedFiles = await listFiles(packageDir);
      expect(packedFiles).toContain('dist/export.js');
      expect(packedFiles).toContain('dist/export.d.ts');
      expect(packedFiles).toContain('dist/utils/export.js');
      expect(packedFiles).toContain('dist/utils/export.d.ts');
      expect(packedFiles).toContain('dist/devices/export.js');
      expect(packedFiles).toContain('dist/bin/cli.js');
      expect(packedFiles.filter((file) => !file.startsWith('dist/'))).toEqual(['npm-shrinkwrap.json', 'package.json']);
      const declarationFiles = packedFiles.filter((file) => file.endsWith('.d.ts'));
      expect(declarationFiles.filter((file) => !file.startsWith('dist/_chunks/'))).toEqual(['dist/devices/export.d.ts', 'dist/export.d.ts', 'dist/utils/export.d.ts']);
      expect(packedFiles.filter((file) => file.endsWith('.map') || file.endsWith('.tsbuildinfo'))).toEqual([]);
      const workspaceImporters: string[] = [];
      for (const file of packedFiles.filter((name) => name.endsWith('.js'))) {
        if ((await readFile(path.join(packageDir, file), 'utf8')).includes('@fixture/')) workspaceImporters.push(file);
      }
      expect(workspaceImporters).toEqual([]);
      expect(await findDeclarationProblems(packageDir, declarationFiles)).toEqual([]);

      await expectConsumable(packageDir, MONOREPO_NAME, 'utils', 'devices');

      // The workspace is restored and rebuilt for development.
      expect(await readFile(path.join(rootDir, 'package.json'), 'utf8')).toBe(originalPackageJson);
      expect(await listFiles(path.join(rootDir, 'packages', 'core', 'dist'))).toContain('greeter.js');
    },
    PACK_TIMEOUT,
  );
});
