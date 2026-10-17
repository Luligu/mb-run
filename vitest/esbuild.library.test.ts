/**
 * @file vitest/esbuild.library.test.ts
 * @description Integration tests that run the real TypeScript 7, esbuild and rollup-plugin-dts tools
 * (nothing mocked) on realistic single-package and monorepo libraries, then install the bundled dist
 * into a fresh consumer that type-checks it with TypeScript 7 and runs it with Node.js.
 * @author Luca Liguori
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runWorkspaceBuild, runWorkspaceTypecheck } from '../src/build.js';
import { runDtsBuild } from '../src/dts.js';
import { runEsbuild } from '../src/esbuild.js';
import { initLogger } from '../src/logger.js';
import {
  consumerRuntimeScript,
  createConsumer,
  createMonorepoFixture,
  createSinglePackageFixture,
  expectedRuntimeResult,
  findDeclarationProblems,
  installIntoConsumer,
  linkInstalledPackages,
  isWindows,
  listFiles,
  MONOREPO_NAME,
  runNode,
  SINGLE_NAME,
} from './fixtures/library.js';

let tmpDir: string;

describe('esbuild + dts (real tools, library package)', () => {
  beforeEach(async () => {
    initLogger({ dryRun: false, verbose: false, rootDir: '' });
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-esbuild-library-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('exposes runEsbuild and runDtsBuild as functions', () => {
    expect(typeof runEsbuild).toBe('function');
    expect(typeof runDtsBuild).toBe('function');
  });

  it('prunes declaration files that the declaration build step will recreate', async () => {
    await writeFile(
      path.join(tmpDir, 'tsconfig.build.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'esnext',
          module: 'esnext',
          moduleResolution: 'bundler',
          rootDir: 'src',
          outDir: 'dist',
          declaration: true,
          strict: true,
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      }),
    );

    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'sample-library',
        version: '1.0.0',
        type: 'module',
        main: './dist/module.js',
        types: './dist/module.d.ts',
        exports: { '.': { import: './dist/module.js', types: './dist/module.d.ts' } },
      }),
    );

    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(
      path.join(tmpDir, 'src', 'module.ts'),
      `export interface Greeting {\n  message: string;\n}\n\nexport function greet(name: string): Greeting {\n  return { message: \`Hello, \${name}!\` };\n}\n`,
    );

    await mkdir(path.join(tmpDir, 'dist'), { recursive: true });
    await writeFile(path.join(tmpDir, 'dist', 'module.js'), `export function greet(name) {\n  return { message: \`Hello, \${name}!\` };\n}\n`);
    const declarationBeforeEsbuild = `export interface Greeting {\n  message: string;\n}\nexport declare function greet(name: string): Greeting;\n`;
    await writeFile(path.join(tmpDir, 'dist', 'module.d.ts'), declarationBeforeEsbuild);
    await writeFile(path.join(tmpDir, 'dist', 'module.d.ts.map'), '{"version":3,"file":"module.d.ts"}\n');

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    await expect(readFile(path.join(tmpDir, 'dist', 'module.d.ts'), 'utf8')).rejects.toThrow('ENOENT');
    await expect(readFile(path.join(tmpDir, 'dist', 'module.d.ts.map'), 'utf8')).rejects.toThrow('ENOENT');
  });
});

describe('esbuild + dts (real tools, realistic fixtures)', () => {
  let rootDir: string;
  let consumerDir: string;

  beforeEach(async () => {
    initLogger({ dryRun: false, verbose: false, rootDir: '' });
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-esbuild-fixture-'));
    rootDir = path.join(tmpDir, 'library');
    consumerDir = path.join(tmpDir, 'consumer');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Runs the real production build, then the real esbuild + declaration build + declaration bundle.
   *
   * @param {boolean} obfuscate Whether to obfuscate the bundled JavaScript.
   * @returns {Promise<void>} Resolves when dist holds the bundled output.
   */
  async function buildAndBundle(obfuscate: boolean): Promise<void> {
    await runWorkspaceBuild({ rootDir, isWindows, dryRun: false, mode: 'production', watch: false });
    await runEsbuild({ rootDir, isWindows, dryRun: false, obfuscate });

    const javascriptFiles = (await listFiles(path.join(rootDir, 'dist'))).filter((file) => file.endsWith('.js'));
    const obfuscatedFiles: string[] = [];
    for (const file of javascriptFiles) {
      if (/_0x[0-9a-f]+/.test(await readFile(path.join(rootDir, 'dist', file), 'utf8'))) obfuscatedFiles.push(file);
    }
    expect(obfuscatedFiles).toEqual(obfuscate ? javascriptFiles : []);
    // npm needs the shebang on the first line of a bin launcher, obfuscated or not.
    expect((await readFile(path.join(rootDir, 'dist', 'bin', 'cli.js'), 'utf8')).startsWith('#!/usr/bin/env node\n')).toBe(true);
  }

  /**
   * Asserts that a bundled declaration file is self-contained: no relative or workspace imports remain.
   *
   * @param {string} filePath Declaration file path.
   * @returns {Promise<string>} The declaration source.
   */
  async function expectSelfContainedDeclaration(filePath: string): Promise<string> {
    const declaration = await readFile(filePath, 'utf8');
    expect(declaration).not.toMatch(/from ['"]\.{1,2}\//);
    expect(declaration).not.toMatch(/import\(['"]\.{1,2}\//);
    expect(declaration).not.toContain('@fixture/');
    return declaration;
  }

  /**
   * Installs the built package into a fresh consumer, then type-checks and runs it there.
   *
   * @param {string} packageName Library package name.
   * @param {string | null} utilsSubpath Subpath export of the utilities, or null when the library has none.
   * @param {string | null} [devicesSubpath] Subpath export of the Greeter subclass, or null when the library has none.
   * @returns {Promise<string>} The installed package directory.
   */
  async function expectConsumable(packageName: string, utilsSubpath: string | null, devicesSubpath: string | null = null): Promise<string> {
    const installedDir = await installIntoConsumer(rootDir, consumerDir, packageName);
    await createConsumer(consumerDir, packageName, utilsSubpath, devicesSubpath);
    // dist is copied in place, so link its runtime dependency and the hoisted path-key the way npm would install them.
    await linkInstalledPackages(consumerDir, ['typescript', '@types/node', 'cross-spawn', 'path-key']);

    await runWorkspaceTypecheck({ rootDir: consumerDir, isWindows, dryRun: false, mode: 'build', watch: false });

    const runtime = runNode(['--input-type=module', '-e', consumerRuntimeScript(packageName, utilsSubpath, devicesSubpath)], consumerDir);
    expect(runtime.stderr).toBe('');
    expect(runtime.status).toBe(0);
    expect(JSON.parse(runtime.stdout)).toEqual(expectedRuntimeResult(devicesSubpath !== null));
    return installedDir;
  }

  it.each([false, true])('should bundle a single-package library into a self-contained dist that a consumer can type-check and run (obfuscate=%s)', async (obfuscate) => {
    await createSinglePackageFixture(rootDir);

    await buildAndBundle(obfuscate);

    const distFiles = await listFiles(path.join(rootDir, 'dist'));
    expect(distFiles).toContain('module.js');
    expect(distFiles).toContain('bin/cli.js');
    // esbuild superseded every per-file module.
    for (const superseded of ['cli.js', 'export.js', 'format.js', 'greeter.js', 'types.js']) expect(distFiles).not.toContain(superseded);
    expect(distFiles.filter((file) => file.endsWith('.map'))).toEqual([]);
    // Only the bundled public declaration entry survives: every per-file declaration is pruned.
    expect(distFiles.filter((file) => file.endsWith('.d.ts'))).toEqual(['module.d.ts']);

    const declaration = await expectSelfContainedDeclaration(path.join(rootDir, 'dist', 'module.d.ts'));
    expect(declaration).toContain('declare class Greeter extends EventEmitter<GreeterEvents>');
    expect(declaration).toContain("from 'node:events'");
    expect(declaration).toContain('declare function formatGreeting(options: GreetingOptions): string;');

    const installedDir = await expectConsumable(SINGLE_NAME, null);
    const cli = runNode([path.join(installedDir, 'dist', 'bin', 'cli.js')], consumerDir);
    expect(cli.stderr).toBe('');
    expect(cli.stdout).toMatch(new RegExp(`^${SINGLE_NAME} Hello, Cli! node v\\d+`));
  });

  it.each([false, true])(
    'should bundle a monorepo library, inlining workspace code and declarations, into a dist that a consumer can type-check and run (obfuscate=%s)',
    async (obfuscate) => {
      await createMonorepoFixture(rootDir);

      await buildAndBundle(obfuscate);

      const distFiles = await listFiles(path.join(rootDir, 'dist'));
      expect(distFiles).toContain('export.js');
      expect(distFiles).toContain('utils/export.js');
      expect(distFiles).toContain('devices/export.js');
      expect(distFiles).toContain('bin/cli.js');
      expect(distFiles.filter((file) => file.endsWith('.map'))).toEqual([]);
      const workspaceImporters: string[] = [];
      const pathKeyImporters: string[] = [];
      for (const file of distFiles.filter((name) => name.endsWith('.js'))) {
        const code = await readFile(path.join(rootDir, 'dist', file), 'utf8');
        if (code.includes('@fixture/')) workspaceImporters.push(file);
        if (/from ?['"]path-key['"]/.test(code)) pathKeyImporters.push(file);
      }
      expect(workspaceImporters).toEqual([]);
      // path-key is imported but declared by no package.json (a hoisted transitive dependency): it must stay external, never be bundled.
      expect(pathKeyImporters).toHaveLength(1);

      // The public declaration entries plus the shared chunks they import from: every class is declared once.
      const declarationFiles = distFiles.filter((file) => file.endsWith('.d.ts'));
      expect(declarationFiles.filter((file) => !file.startsWith('_chunks/'))).toEqual(['devices/export.d.ts', 'export.d.ts', 'utils/export.d.ts']);
      expect(await findDeclarationProblems(path.join(rootDir, 'dist'), declarationFiles)).toEqual([]);
      let declarations = '';
      for (const file of declarationFiles) declarations += await readFile(path.join(rootDir, 'dist', file), 'utf8');
      expect(declarations.match(/declare class Greeter extends EventEmitter<GreeterEvents>/g)).toHaveLength(1);
      expect(declarations).toContain('declare enum LogLevel');
      expect(declarations).toContain('declare class LoudGreeter extends Greeter');
      expect(await readFile(path.join(rootDir, 'dist', 'utils', 'export.d.ts'), 'utf8')).not.toContain('Greeter');

      const installedDir = await expectConsumable(MONOREPO_NAME, 'utils', 'devices');
      const cli = runNode([path.join(installedDir, 'dist', 'bin', 'cli.js')], consumerDir);
      expect(cli.stderr).toBe('');
      expect(cli.stdout).toMatch(new RegExp(`^${MONOREPO_NAME} Hello, Cli! node v\\d+`));
    },
  );
});
