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
      const listener = args[1];
      queueMicrotask(listener);
      return process.stdin;
    });

    await expect(runUpgrade({ rootDir: 'C:/test-package', isWindows: true, dryRun: false, enableJest: false, enableVitest: false })).resolves.toBeUndefined();

    expect(vi.mocked(execSync)).toHaveBeenCalled();
    expect(vi.mocked(log)).toHaveBeenCalledWith(expect.stringContaining('Upgrading'));
  });

  it.each(['patterns', 'empty'])('should merge local ignores when upgrading with %s automator.ignore entries', async (mode) => {
    vi.mocked(writeFileSync).mockClear();
    const rootDir = path.resolve('local-ignores');
    const oxcConfig = '{"ignorePatterns": ["**/bun.lock"]}';
    const vitestConfig = "    exclude: [\n      '**/tmp/',\n    ],\n      exclude: [\n        '**/tmp/',\n      ],";
    const patterns = mode === 'empty' ? [] : ['custom/**', '$&.ts'];
    vi.mocked(parsePackageJson).mockResolvedValue({
      ...structuredClone(packageJson),
      automator: { ...packageJson.automator, vitest: true, ignore: { oxfmt: patterns, oxlint: patterns, vitest: patterns } },
    });
    vi.mocked(existsSync).mockImplementation((filePath) => /(\.(oxfmt|oxlint)rc\.json|vitest\.config\.ts)$/.test(String(filePath)));
    vi.mocked(readFileSync).mockImplementation((filePath) => (String(filePath).endsWith('vitest.config.ts') ? vitestConfig : oxcConfig));

    await runUpgrade({ rootDir, isWindows: process.platform === 'win32', dryRun: false, enableVitest: true });

    for (const tool of ['oxfmt', 'oxlint']) {
      const writes = vi.mocked(writeFileSync).mock.calls.filter(([filePath]) => filePath === path.join(rootDir, `.${tool}rc.json`));
      const expectedWrites = mode === 'empty' ? [] : [[path.join(rootDir, `.${tool}rc.json`), '{"ignorePatterns": ["**/bun.lock",\n    "custom/**",\n    "$&.ts"]}', 'utf8']];
      expect(writes).toEqual(expectedWrites);
    }

    const vitestWrites = vi.mocked(writeFileSync).mock.calls.filter(([filePath]) => filePath === path.join(rootDir, 'vitest.config.ts'));
    const expectedVitestWrites =
      mode === 'empty'
        ? []
        : [
            [
              path.join(rootDir, 'vitest.config.ts'),
              "    exclude: [\n      '**/tmp/',\n      'custom/**',\n      '$&.ts',\n    ],\n      exclude: [\n        '**/tmp/',\n      ],",
              'utf8',
            ],
            [
              path.join(rootDir, 'vitest.config.ts'),
              "    exclude: [\n      '**/tmp/',\n    ],\n      exclude: [\n        '**/tmp/',\n        'custom/**',\n        '$&.ts',\n      ],",
              'utf8',
            ],
          ];
    expect(vitestWrites).toEqual(expectedVitestWrites);
  });

  it('replaces the managed section of .vscode/tasks.json when the file already exists', async () => {
    vi.mocked(writeFileSync).mockClear();
    const rootDir = path.resolve('existing-tasks');
    const templateTasks = '{\n  "tasks": [\n    // --DO NOT EDIT BELOW THIS LINE--\n    { "label": "Build" }\n    // --DO NOT EDIT ABOVE THIS LINE--\n  ]\n}';
    const targetTasksWithCustom =
      '{\n  "tasks": [\n    // --DO NOT EDIT BELOW THIS LINE--\n    { "label": "Old" },\n    // --DO NOT EDIT ABOVE THIS LINE--\n    { "label": "Custom" }\n  ]\n}';
    const targetTasksWithoutCustom = '{\n  "tasks": [\n    // --DO NOT EDIT BELOW THIS LINE--\n    { "label": "Old" }\n    // --DO NOT EDIT ABOVE THIS LINE--\n  ]\n}';
    vi.mocked(parsePackageJson).mockResolvedValue(structuredClone(packageJson));
    vi.mocked(existsSync).mockImplementation((filePath) => String(filePath) === path.join(rootDir, '.vscode', 'tasks.json'));
    vi.mocked(readFileSync).mockImplementation((filePath) => {
      if (String(filePath).includes(path.join('template', '.vscode', 'tasks.json'))) return templateTasks;
      if (String(filePath) === path.join(rootDir, '.vscode', 'tasks.json')) return targetTasksWithCustom;
      return '{}';
    });

    await runUpgrade({ rootDir, isWindows: process.platform === 'win32', dryRun: false });

    const tasksWritesWithCustom = vi.mocked(writeFileSync).mock.calls.filter(([filePath]) => filePath === path.join(rootDir, '.vscode', 'tasks.json'));
    expect(tasksWritesWithCustom).toEqual([
      [
        path.join(rootDir, '.vscode', 'tasks.json'),
        '{\n  "tasks": [\n    // --DO NOT EDIT BELOW THIS LINE--\n    { "label": "Build" },\n    // --DO NOT EDIT ABOVE THIS LINE--\n    { "label": "Custom" }\n  ]\n}',
        'utf8',
      ],
    ]);

    vi.mocked(writeFileSync).mockClear();
    vi.mocked(readFileSync).mockImplementation((filePath) => {
      if (String(filePath).includes(path.join('template', '.vscode', 'tasks.json'))) return templateTasks;
      if (String(filePath) === path.join(rootDir, '.vscode', 'tasks.json')) return targetTasksWithoutCustom;
      return '{}';
    });

    await runUpgrade({ rootDir, isWindows: process.platform === 'win32', dryRun: false });

    const tasksWritesWithoutCustom = vi.mocked(writeFileSync).mock.calls.filter(([filePath]) => filePath === path.join(rootDir, '.vscode', 'tasks.json'));
    expect(tasksWritesWithoutCustom).toEqual([
      [
        path.join(rootDir, '.vscode', 'tasks.json'),
        '{\n  "tasks": [\n    // --DO NOT EDIT BELOW THIS LINE--\n    { "label": "Build" }\n    // --DO NOT EDIT ABOVE THIS LINE--\n  ]\n}',
        'utf8',
      ],
    ]);

    vi.mocked(writeFileSync).mockClear();
    vi.mocked(readFileSync).mockReturnValue('{\n  "tasks": []\n}');
    await runUpgrade({ rootDir, isWindows: process.platform === 'win32', dryRun: false });
    expect(vi.mocked(log)).toHaveBeenCalledWith(expect.stringContaining('No DO NOT EDIT markers found in .vscode/tasks.json, skipping update...'));
  });

  it('upgrades a package with missing metadata without waiting for terminal input', async () => {
    vi.mocked(parsePackageJson).mockResolvedValue({});
    vi.mocked(readFileSync).mockReturnValue('{}');
    vi.mocked(isMonorepo).mockResolvedValue(false);
    vi.mocked(isPlugin).mockResolvedValue(false);
    vi.mocked(isLibrary).mockResolvedValue(false);
    vi.spyOn(process.stdin, 'once').mockImplementation((...args) => {
      const listener = args[1];
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
      const listener = args[1];
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

  it('should skip OS junk files when copying a directory', () => {
    vi.mocked(copyFileSync).mockClear();
    vi.mocked(statSync)
      .mockReturnValueOnce({ isDirectory: (): boolean => true } as ReturnType<typeof statSync>)
      .mockReturnValueOnce({ isDirectory: (): boolean => false } as ReturnType<typeof statSync>);
    vi.mocked(readdirSync).mockReturnValue(['.DS_Store', 'Thumbs.db', 'desktop.ini', 'child.txt'] as never);
    vi.mocked(existsSync).mockReturnValue(false);
    copyRecursive('source', 'destination');
    expect(vi.mocked(copyFileSync)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(copyFileSync)).toHaveBeenCalledWith(expect.stringContaining('child.txt'), expect.stringContaining('child.txt'));
  });

  it('covers package warnings and coverage script variants', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileSync).mockReturnValue('{}');
    vi.spyOn(process.stdin, 'once').mockImplementation((...args) => {
      const listener = args[1];
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
      const listener = args[1];
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

  it('skips script setup when automator.skipPackageJson or automator.app is set', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileSync).mockReturnValue('{}');

    await runPackageJsonUpgrade(
      { rootDir: path.resolve('skip-package-json'), isWindows: false, dryRun: false, enableJest: false, enableVitest: false },
      path.resolve('skip-package-json/package.json'),
      { ...structuredClone(packageJson), automator: { skipPackageJson: true } },
    );
    expect(vi.mocked(log)).toHaveBeenCalledWith(expect.stringContaining('SkipPackageJson detected, skipping script setup'));

    await runPackageJsonUpgrade(
      { rootDir: path.resolve('app-package'), isWindows: false, dryRun: false, enableJest: false, enableVitest: false },
      path.resolve('app-package/package.json'),
      { ...structuredClone(packageJson), automator: { app: true } },
    );
    expect(vi.mocked(log)).toHaveBeenCalledWith(expect.stringContaining('App detected, skipping script setup'));
  });

  it('covers private-package script removal, Bun-only npm pkg sets, and skipped npm pkg set with pending updates', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileSync).mockReturnValue('{}');

    const { license: _license, ...packageJsonWithoutLicense } = structuredClone(packageJson);
    await runPackageJsonUpgrade(
      { rootDir: path.resolve('private-bun-package'), isWindows: false, dryRun: false, enableJest: false, enableVitest: false },
      path.resolve('private-bun-package/package.json'),
      { ...packageJsonWithoutLicense, private: true, automator: { bun: true, skipPackageJson: true, jestTypes: true, vitestTypes: true, bundle: true, obfuscate: true } },
    );
    expect(vi.mocked(unlinkSync)).not.toHaveBeenCalledWith(expect.stringContaining(path.join('scripts', 'downloads.mjs')));
    expect(vi.mocked(execSync)).not.toHaveBeenCalledWith(expect.stringContaining('npm pkg set "license='), expect.anything());
  });

  it('removes the vendored scripts/esbuild.mjs even when bundle is enabled', async () => {
    vi.clearAllMocks();
    const esbuildScript = path.join('scripts', 'esbuild.mjs');
    vi.mocked(existsSync).mockImplementation((filePath) => String(filePath).endsWith(esbuildScript));
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileSync).mockReturnValue('{}');

    await runPackageJsonUpgrade(
      { rootDir: path.resolve('esbuild-script-package'), isWindows: false, dryRun: false, enableJest: false, enableVitest: false, enableBundle: true },
      path.resolve('esbuild-script-package/package.json'),
      { ...structuredClone(packageJson), automator: { bundle: true } },
    );

    expect(vi.mocked(unlinkSync)).toHaveBeenCalledWith(expect.stringContaining(esbuildScript));
  });

  it('removes the bundling devDependencies without reinstalling them, since mb-run --esbuild ships its own', async () => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileSync).mockReturnValue('{}');

    const bundlePkgJson = {
      ...structuredClone(packageJson),
      automator: { bundle: true, minify: true, obfuscate: true },
      devDependencies: {
        'esbuild': '0.0.0',
        'javascript-obfuscator': '0.0.0',
        'rollup': '0.0.0',
        'rollup-plugin-dts': '0.0.0',
        '@typescript/typescript6': '0.0.0',
      },
    };
    await runPackageJsonUpgrade(
      { rootDir: path.resolve('bundle-package'), isWindows: false, dryRun: false, enableJest: false, enableVitest: false, enableBundle: true, enableObfuscate: true },
      path.resolve('bundle-package/package.json'),
      bundlePkgJson,
    );

    expect(bundlePkgJson.devDependencies).toEqual({});
    for (const dependency of ['esbuild', 'javascript-obfuscator', 'rollup', '@typescript/typescript6']) {
      expect(vi.mocked(execSync)).not.toHaveBeenCalledWith(expect.stringContaining(dependency), expect.anything());
    }
  });

  it('builds prepublishOnly with mb-run --esbuild when bundle is enabled and drops the bundle, minify and obfuscate scripts', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileSync).mockReturnValue('{}');

    const esbuild = 'npx --yes mb-run@latest --esbuild';
    const prepublishTail = ' && node scripts/prepublish-clean.mjs && npm install --no-fund --no-audit --omit=dev && npm shrinkwrap --omit=dev';
    const cases: { automator: Record<string, boolean>; prepublishOnly: string }[] = [
      { automator: {}, prepublishOnly: `npm run cleanBuildProduction${prepublishTail}` },
      // minify and obfuscate need bundle
      { automator: { minify: true, obfuscate: true }, prepublishOnly: `npm run cleanBuildProduction${prepublishTail}` },
      { automator: { bundle: true }, prepublishOnly: `${esbuild}${prepublishTail}` },
      { automator: { bundle: true, minify: true }, prepublishOnly: `${esbuild} minify${prepublishTail}` },
      { automator: { bundle: true, obfuscate: true }, prepublishOnly: `${esbuild} obfuscate${prepublishTail}` },
      { automator: { bundle: true, minify: true, obfuscate: true }, prepublishOnly: `${esbuild} minify obfuscate${prepublishTail}` },
    ];

    for (const isLibrary of [false, true]) {
      for (const { automator, prepublishOnly } of cases) {
        const pkg: { automator: Record<string, boolean>; scripts?: Record<string, string> } = {
          ...structuredClone(packageJson),
          automator,
          // Scripts from earlier upgrades are dropped: the Bundle, Minify and Obfuscate tasks replace them
          scripts: { bundle: 'old', minify: 'old', obfuscate: 'old' },
        };
        await runPackageJsonUpgrade(
          { rootDir: path.resolve('esbuild-scripts'), isWindows: false, dryRun: false },
          path.resolve('esbuild-scripts/package.json'),
          pkg,
          false,
          false,
          false,
          isLibrary,
        );
        expect(pkg.scripts?.bundle).toBeUndefined();
        expect(pkg.scripts?.minify).toBeUndefined();
        expect(pkg.scripts?.obfuscate).toBeUndefined();
        expect(pkg.scripts?.prepublishOnly).toBe(prepublishOnly);
      }
    }
  });

  it('installs jestTypes and vitestTypes devDependencies for workspace packages', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileSync).mockReturnValue('{}');

    await runPackageJsonUpgrade(
      { rootDir: path.resolve('workspace-types'), isWindows: false, dryRun: false, enableJest: false, enableVitest: false },
      path.resolve('workspace-types/package.json'),
      { ...structuredClone(packageJson), automator: { node: true, bun: true, jestTypes: true, vitestTypes: true } },
      false,
      true,
    );
    expect(vi.mocked(execSync)).toHaveBeenCalledWith(expect.stringContaining('@types/jest'), expect.anything());
    expect(vi.mocked(execSync)).toHaveBeenCalledWith(expect.stringContaining('vitest'), expect.anything());
    expect(vi.mocked(execSync)).toHaveBeenCalledWith(expect.stringContaining('@types/node'), expect.anything());
    expect(vi.mocked(execSync)).not.toHaveBeenCalledWith(expect.stringContaining('@types/node@'), expect.anything());
  });

  it('keeps the scripts of a workspace package when automator.skipPackageJson is set', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileSync).mockReturnValue('{}');

    const workspacePkgJson = { ...structuredClone(packageJson), automator: { skipPackageJson: true } };
    await runPackageJsonUpgrade(
      { rootDir: path.resolve('workspace-skip'), isWindows: false, dryRun: false, enableJest: false, enableVitest: false },
      path.resolve('workspace-skip/package.json'),
      workspacePkgJson,
      false,
      true,
    );

    expect(workspacePkgJson.scripts).toEqual(packageJson.scripts);
    expect(vi.mocked(log)).toHaveBeenCalledWith(expect.stringContaining('skipPackageJson, keeping its scripts'));
  });

  it('sets publish and chip scripts when automator flags are enabled', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileSync).mockReturnValue('{}');

    await runPackageJsonUpgrade(
      { rootDir: path.resolve('publish-package'), isWindows: false, dryRun: false, enableJest: false, enableVitest: false },
      path.resolve('publish-package/package.json'),
      { ...structuredClone(packageJson), automator: { chip: true, publish: true } },
    );

    expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(expect.stringContaining('package.json'), expect.stringContaining('npmPublishTagLatest'), 'utf8');
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(expect.stringContaining('package.json'), expect.stringContaining('chip:test'), 'utf8');
  });

  it('configures softReset and softReset:bun scripts for Node, Bun, and plugin variants', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileSync).mockReturnValue('{}');

    const pkgPlugin = { ...structuredClone(packageJson), automator: { node: true, bun: true } };
    await runPackageJsonUpgrade(
      { rootDir: path.resolve('soft-reset-plugin-both'), isWindows: false, dryRun: false },
      path.resolve('soft-reset-plugin-both/package.json'),
      pkgPlugin,
      false,
      false,
      true,
      false,
    );
    expect(pkgPlugin.scripts).toMatchObject({
      'softReset': 'npm install --no-fund --no-audit && npm prune --no-fund --no-audit && npm link --no-fund --no-audit matterbridge && npm run build && npm run typecheck',
      'softReset:bun': 'bun install && bun prune && bun link matterbridge && bun run build && bun run typecheck',
    });

    const pkgPluginBunOnly = { ...structuredClone(packageJson), automator: { node: false, bun: true } };
    await runPackageJsonUpgrade(
      { rootDir: path.resolve('soft-reset-plugin-bun'), isWindows: false, dryRun: false },
      path.resolve('soft-reset-plugin-bun/package.json'),
      pkgPluginBunOnly,
      false,
      false,
      true,
      false,
    );
    const bunOnlyPluginScripts = pkgPluginBunOnly.scripts as Record<string, string | undefined>;
    expect(bunOnlyPluginScripts['softReset']).toBe('bun install && bun prune && bun link matterbridge && bun run build && bun run typecheck');
    expect(bunOnlyPluginScripts['softReset:bun']).toBeUndefined();

    const pkgNoPluginBunOnly = { ...structuredClone(packageJson), automator: { node: false, bun: true } };
    await runPackageJsonUpgrade(
      { rootDir: path.resolve('soft-reset-no-plugin-bun'), isWindows: false, dryRun: false },
      path.resolve('soft-reset-no-plugin-bun/package.json'),
      pkgNoPluginBunOnly,
      false,
      false,
      false,
      false,
    );
    const bunOnlyNoPluginScripts = pkgNoPluginBunOnly.scripts as Record<string, string | undefined>;
    expect(bunOnlyNoPluginScripts['softReset']).toBe('bun install && bun prune && bun run build && bun run typecheck');
    expect(bunOnlyNoPluginScripts['softReset:bun']).toBeUndefined();
  });
});
