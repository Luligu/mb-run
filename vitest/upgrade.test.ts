/**
 * @file vitest/upgrade.test.ts
 * @description This file contains the tests for the upgrade utilities.
 * @author Luca Liguori
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));
vi.mock('node:fs', () => ({
  appendFileSync: vi.fn(),
  copyFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  statSync: vi.fn().mockReturnValue({ isDirectory: () => false }),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('../src/ansi.js', () => ({
  cyan: (value: string): string => value,
  green: (value: string): string => value,
  log: vi.fn(),
  magenta: (value: string): string => value,
  red: (value: string): string => value,
  reset: (): string => '',
}));
vi.mock('../src/cache.js', () => ({ resolveWorkspacePackageJsonPaths: vi.fn().mockResolvedValue([]) }));
vi.mock('../src/clean.js', () => ({ emptyDir: vi.fn(), fileExists: vi.fn().mockResolvedValue(false) }));
vi.mock('../src/helpers.js', () => ({
  isLibrary: vi.fn().mockResolvedValue(false),
  isMonorepo: vi.fn().mockResolvedValue(false),
  isPlugin: vi.fn().mockResolvedValue(false),
  parsePackageJson: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { log } from '../src/ansi.js';
import { resolveWorkspacePackageJsonPaths } from '../src/cache.js';
import { fileExists } from '../src/clean.js';
import { isLibrary, isMonorepo, isPlugin, parsePackageJson } from '../src/helpers.js';
import {
  appendFileToFileIfExists,
  copyRecursive,
  countOccurrences,
  fileReplace,
  fileReplaceFromTo,
  findMatchAfter,
  mkDirSafe,
  pressyAnyKey,
  removeDirSafe,
  resolveDstPath,
  runPackageJsonUpgrade,
  runSafe,
  runUpgrade,
  tryParseRegexString,
  unlinkSafe,
} from '../src/upgrade.js';

const packageJson = {
  name: 'test-package',
  version: '1.0.0',
  description: 'test package',
  homepage: 'https://example.com',
  type: 'module',
  main: 'dist/module.js',
  types: 'dist/module.d.ts',
  exports: { '.': './dist/module.js' },
  repository: { type: 'git', url: 'https://example.com/repo.git' },
  bugs: { url: 'https://example.com/issues' },
  funding: { type: 'custom', url: 'https://example.com/funding' },
  keywords: ['test'],
  engines: { node: '>=20' },
  license: 'Apache-2.0',
  author: 'Test Author',
  files: ['dist'],
  scripts: { start: 'node dist/module.js' },
  devDependencies: {},
  automator: { jest: false, vitest: false },
};

const missingFilePath = path.resolve('missing.txt');
const testFilePath = path.resolve('test.txt');

describe('upgrade', () => {
  it('parses and finds literal and regular-expression matches', () => {
    expect(tryParseRegexString(/test/)).toEqual(/test/);
    expect(tryParseRegexString('/te.st/gi')).toMatchObject({ source: 'te.st', flags: 'gi' });
    expect(tryParseRegexString('/[/')).toBeNull();
    expect(tryParseRegexString('test')).toBeNull();
    expect(findMatchAfter('one two one', 'one', 1)).toEqual({ index: 8, endIndex: 11, text: 'one' });
    expect(findMatchAfter('one two', /two/)).toEqual({ index: 4, endIndex: 7, text: 'two' });
    expect(findMatchAfter('one', '', 0)).toBeNull();
    expect(countOccurrences('aaaa', 'aa')).toBe(2);
    expect(countOccurrences('test', '')).toBe(0);
  });

  it('updates matching file content and reports unchanged or missing files', () => {
    vi.mocked(existsSync).mockReturnValueOnce(false);
    expect(fileReplace(missingFilePath, 'one', 'two')).toEqual({ changed: false, replacements: 0 });

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('one one');
    expect(fileReplace(testFilePath, 'one', 'two', { dryRun: true })).toEqual({ changed: true, replacements: 2 });
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();

    vi.mocked(readFileSync).mockReturnValue('one two one');
    expect(fileReplace(testFilePath, /one/, 'three')).toEqual({ changed: true, replacements: 1 });
    expect(vi.mocked(writeFileSync)).toHaveBeenCalled();
  });

  it('replaces content between matching boundaries', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('before [start] old [end] after');
    expect(fileReplaceFromTo(testFilePath, '[start]', '[end]', ' new ', { dryRun: true })).toEqual({ changed: true, replacements: 1 });
    expect(fileReplaceFromTo(testFilePath, '[missing]', '[end]', ' new ')).toEqual({ changed: false, replacements: 0 });
  });

  it('returns success and failure states for shell commands', () => {
    vi.mocked(execSync).mockImplementationOnce(() => Buffer.from(''));
    expect(runSafe('npm test')).toBe(true);
    vi.mocked(execSync).mockImplementationOnce(() => {
      const error = new Error('failed') as Error & { status: number };
      error.status = 1;
      throw error;
    });
    expect(runSafe('npm test')).toBe(false);
    expect(runSafe('')).toBe(false);
  });

  it('upgrades a package with isolated filesystem and command dependencies', async () => {
    vi.mocked(parsePackageJson).mockResolvedValue(structuredClone(packageJson));
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(packageJson));
    vi.spyOn(process.stdin, 'once').mockImplementation((...args) => {
      const listener = args[1] as () => void;
      queueMicrotask(listener);
      return process.stdin;
    });

    await expect(runUpgrade({ rootDir: 'C:/test-package', isWindows: true, dryRun: false, enableJest: false, enableVitest: false })).resolves.toBeUndefined();

    expect(vi.mocked(execSync)).toHaveBeenCalled();
    expect(vi.mocked(log)).toHaveBeenCalledWith(expect.stringContaining('Upgrading'));
  });

  it('upgrades a package with missing metadata without waiting for terminal input', async () => {
    vi.mocked(parsePackageJson).mockResolvedValue({});
    vi.mocked(readFileSync).mockReturnValue('{}');
    vi.mocked(isMonorepo).mockResolvedValue(false);
    vi.mocked(isPlugin).mockResolvedValue(false);
    vi.mocked(isLibrary).mockResolvedValue(false);
    vi.spyOn(process.stdin, 'once').mockImplementation((...args) => {
      const listener = args[1] as () => void;
      queueMicrotask(listener);
      return process.stdin;
    });

    await expect(
      runUpgrade({ rootDir: path.resolve('missing-metadata'), isWindows: process.platform === 'win32', dryRun: false, enableJest: false, enableVitest: false }),
    ).resolves.toBeUndefined();
    expect(vi.mocked(log)).toHaveBeenCalledWith(expect.stringContaining('No name field found'));
  });

  it.each([
    ['plugin', false, true, false],
    ['library', false, false, true],
    ['monorepo', true, false, false],
  ])('upgrades a %s package configuration', async (_name, monorepo, plugin, library) => {
    vi.mocked(parsePackageJson).mockResolvedValue({
      ...structuredClone(packageJson),
      automator: { jest: true, vitest: true, git: true, version: true, publish: true, coverage: { lines: 100, functions: 100, statements: 100, branches: 100 } },
      workspaces: monorepo ? ['packages/*'] : undefined,
      keywords: plugin ? [] : packageJson.keywords,
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(packageJson));
    vi.mocked(isMonorepo).mockResolvedValue(monorepo);
    vi.mocked(isPlugin).mockResolvedValue(plugin);
    vi.mocked(isLibrary).mockResolvedValue(library);
    vi.spyOn(process.stdin, 'once').mockImplementation((...args) => {
      const listener = args[1] as () => void;
      queueMicrotask(listener);
      return process.stdin;
    });

    await expect(
      runUpgrade({
        rootDir: path.resolve('test-package'),
        isWindows: process.platform === 'win32',
        dryRun: false,
        enableJest: false,
        enableVitest: false,
        enableBundle: true,
        enableObfuscate: true,
      }),
    ).resolves.toBeUndefined();
  });

  it('copies files and safely removes existing paths', () => {
    vi.mocked(statSync).mockReturnValue({ isDirectory: (): boolean => false } as ReturnType<typeof statSync>);
    vi.mocked(existsSync).mockReturnValue(true);
    copyRecursive('source.txt', path.resolve('target.txt'));
    expect(vi.mocked(copyFileSync)).toHaveBeenCalled();

    expect(resolveDstPath(path.resolve('target.txt'))).toBe(path.resolve('target.txt'));
    expect(mkDirSafe(path.resolve('target-dir'))).toBe(false);
    expect(unlinkSafe(path.resolve('target.txt'))).toBe(true);
    expect(removeDirSafe(path.resolve('target-dir'))).toBe(true);
    expect(vi.mocked(unlinkSync)).toHaveBeenCalled();
    expect(vi.mocked(rmSync)).toHaveBeenCalled();
  });

  it('covers workspace upgrades and reports command failures', async () => {
    const workspacePath = path.resolve('packages/workspace/package.json');
    vi.mocked(parsePackageJson).mockResolvedValue(structuredClone(packageJson));
    vi.mocked(resolveWorkspacePackageJsonPaths).mockResolvedValue([workspacePath]);
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw new Error('command failure');
    });

    await runUpgrade({ rootDir: path.resolve('monorepo'), isWindows: false, dryRun: false, enableJest: false, enableVitest: false });

    expect(vi.mocked(parsePackageJson)).toHaveBeenCalledWith(path.dirname(workspacePath));
    expect(vi.mocked(log)).toHaveBeenCalledWith(expect.stringContaining('Failed commands:'));
    await expect(runUpgrade({ rootDir: path.resolve('skipped'), isWindows: false, dryRun: true, enableJest: false, enableVitest: false })).resolves.toBeUndefined();
  });

  it('handles workspace and fully configured plugin package variants', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileSync).mockReturnValue('{}');

    await runPackageJsonUpgrade(
      { rootDir: path.resolve('workspace'), isWindows: false, dryRun: false, enableJest: true, enableVitest: true },
      path.resolve('workspace/package.json'),
      structuredClone(packageJson),
      false,
      true,
      false,
      false,
    );

    const pluginPackage = {
      ...structuredClone(packageJson),
      files: undefined,
      keywords: [
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
      ],
    };
    await runPackageJsonUpgrade(
      { rootDir: path.resolve('plugin'), isWindows: false, dryRun: false, enableJest: true, enableVitest: true },
      path.resolve('plugin/package.json'),
      pluginPackage,
      false,
      false,
      true,
      false,
    );

    expect(vi.mocked(log)).toHaveBeenCalledWith('All plugin keywords are already present, skipping keyword update.');
  });

  it('handles file helper edge cases and regular-expression replacements', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('one one');
    expect(fileReplace(testFilePath, /one/g, 'two', { dryRun: true })).toEqual({ changed: true, replacements: 2 });
    expect(fileReplace(testFilePath, 'missing', 'two', { dryRun: true })).toEqual({ changed: false, replacements: 0 });
    expect(fileReplaceFromTo(testFilePath, 'one', 'missing', 'two')).toEqual({ changed: false, replacements: 0 });
    expect(fileReplaceFromTo(testFilePath, 'one', 'one', 'two', { includeBounds: true, dryRun: true })).toEqual({ changed: true, replacements: 1 });
    expect(tryParseRegexString('/test/z')).toBeNull();
    expect(tryParseRegexString('/a\\/b/i')).toMatchObject({ source: 'a\\/b', flags: 'i' });
    expect(findMatchAfter('one', /two/)).toBeNull();
    expect(unlinkSafe(path.resolve('missing.txt'))).toBe(true);
    vi.mocked(existsSync).mockReturnValue(false);
    expect(unlinkSafe(path.resolve('missing.txt'))).toBe(false);
    expect(mkDirSafe(path.resolve('missing-dir'))).toBe(true);
    expect(removeDirSafe(path.resolve('missing-dir'))).toBe(false);
    expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith(path.resolve('missing-dir'), { recursive: true });
  });

  it('copies directories and appends non-empty local files', () => {
    vi.mocked(statSync)
      .mockReturnValueOnce({ isDirectory: (): boolean => true } as ReturnType<typeof statSync>)
      .mockReturnValueOnce({ isDirectory: (): boolean => false } as ReturnType<typeof statSync>);
    vi.mocked(readdirSync).mockReturnValue(['child.txt'] as never);
    copyRecursive('source', 'destination');
    expect(vi.mocked(mkdirSync)).toHaveBeenCalled();

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('content');
    appendFileToFileIfExists('.localignore', '.gitignore');
    expect(vi.mocked(appendFileSync)).toHaveBeenCalledWith(expect.any(String), '\ncontent', 'utf8');
    vi.mocked(readFileSync).mockReturnValue('  ');
    appendFileToFileIfExists('.localignore', '.gitignore');
  });

  it('covers package warnings and coverage script variants', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileSync).mockReturnValue('{}');
    vi.spyOn(process.stdin, 'once').mockImplementation((...args) => {
      const listener = args[1] as () => void;
      queueMicrotask(listener);
      return process.stdin;
    });

    for (const coverage of [{ lines: 100, functions: 100 }, { lines: 100 }]) {
      await runPackageJsonUpgrade(
        { rootDir: path.resolve('coverage-variants'), isWindows: false, dryRun: false, enableJest: true, enableVitest: true },
        path.resolve('coverage-variants/package.json'),
        { ...structuredClone(packageJson), automator: { coverage }, workspaces: ['packages/*'] },
      );
    }
    expect(vi.mocked(log)).toHaveBeenCalledWith(expect.stringContaining('workspaces field found'));
  });

  it('enables Bun test scaffolding and Bun tsconfig types from automator settings', async () => {
    vi.clearAllMocks();
    vi.mocked(parsePackageJson).mockResolvedValue({ ...structuredClone(packageJson), automator: { node: true, bun: true, buntest: true } });
    vi.mocked(isMonorepo).mockResolvedValue(false);
    vi.mocked(isPlugin).mockResolvedValue(false);
    vi.mocked(isLibrary).mockResolvedValue(false);
    vi.mocked(resolveWorkspacePackageJsonPaths).mockResolvedValue([]);
    vi.mocked(existsSync).mockImplementation((filePath) => {
      const normalizedPath = String(filePath).replaceAll('\\', '/');
      if (normalizedPath.endsWith('/packages') || normalizedPath.endsWith('/buntest')) return false;
      return true;
    });
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileSync).mockReturnValue('{"compilerOptions":{"types":["node"]}}');

    await runUpgrade({ rootDir: path.resolve('bun-enabled'), isWindows: false, dryRun: false, enableJest: false, enableVitest: false });

    expect(vi.mocked(copyFileSync)).toHaveBeenCalledWith(expect.stringContaining('bunfig.toml'), expect.stringContaining('bunfig.toml'));
    expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith(path.resolve('bun-enabled/buntest'), { recursive: true });
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(expect.stringContaining('tsconfig.json'), expect.stringContaining('"bun"'), 'utf8');
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(expect.stringContaining('tsconfig.build.json'), expect.stringContaining('"bun"'), 'utf8');
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(expect.stringContaining('tsconfig.build.production.json'), expect.stringContaining('"bun"'), 'utf8');
  });

  it('covers terminal, destination-directory, and unchanged replacement paths', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    const setRawMode = vi.fn();
    Object.assign(process.stdin, { isRaw: false, setRawMode });
    vi.spyOn(process.stdin, 'once').mockImplementation((...args) => {
      const listener = args[1] as () => void;
      queueMicrotask(listener);
      return process.stdin;
    });
    await pressyAnyKey('');
    expect(setRawMode).toHaveBeenCalledWith(true);
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: originalIsTTY });

    vi.mocked(statSync)
      .mockReturnValueOnce({ isDirectory: (): boolean => false } as ReturnType<typeof statSync>)
      .mockReturnValueOnce({ isDirectory: (): boolean => true } as ReturnType<typeof statSync>);
    vi.mocked(existsSync).mockReturnValue(true);
    copyRecursive('source.txt', 'destination/');
    expect(vi.mocked(copyFileSync)).toHaveBeenCalled();

    vi.mocked(readFileSync).mockReturnValue('[]');
    expect(fileReplaceFromTo(testFilePath, '[', ']', '', { dryRun: false })).toEqual({ changed: false, replacements: 0 });
    vi.mocked(existsSync).mockReturnValue(false);
    expect(fileReplaceFromTo(testFilePath, '[', ']', '')).toEqual({ changed: false, replacements: 0 });
  });

  it('handles invalid match inputs and non-Error command failures', () => {
    expect(tryParseRegexString(null as never)).toBeNull();
    expect(tryParseRegexString('//')).toBeNull();
    vi.mocked(execSync).mockImplementationOnce(() => {
      // oxlint-disable-next-line typescript/only-throw-error -- verifies runSafe handles non-Error throws
      throw 'failed';
    });
    expect(runSafe('npm test')).toBe(false);
  });

  it('covers existing destination directories, global matches, and newline prefixes', async () => {
    vi.mocked(statSync)
      .mockReturnValueOnce({ isDirectory: (): boolean => false } as ReturnType<typeof statSync>)
      .mockReturnValueOnce({ isDirectory: (): boolean => true } as ReturnType<typeof statSync>);
    vi.mocked(existsSync).mockReturnValue(true);
    copyRecursive('source.txt', 'destination');
    expect(vi.mocked(copyFileSync)).toHaveBeenCalled();
    expect(findMatchAfter('one two one', /one/g, 1)).toEqual({ index: 8, endIndex: 11, text: 'one' });

    vi.mocked(readFileSync).mockReturnValue('\ncontent');
    appendFileToFileIfExists('.localignore', '.gitignore');
    expect(vi.mocked(appendFileSync)).toHaveBeenCalledWith(expect.any(String), '\ncontent', 'utf8');
    vi.mocked(readFileSync).mockReturnValue('[start] old [end]');
    expect(fileReplaceFromTo(testFilePath, '[start]', '[end]', ' new ')).toEqual({ changed: true, replacements: 1 });

    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileSync).mockReturnValue('{}');
    for (const keywords of ['custom', '   ']) {
      await runPackageJsonUpgrade(
        { rootDir: path.resolve('plugin-keywords'), isWindows: false, dryRun: false, enableJest: false, enableVitest: false },
        path.resolve('plugin-keywords/package.json'),
        { ...structuredClone(packageJson), keywords },
        false,
        false,
        true,
        false,
      );
    }
  });
});
