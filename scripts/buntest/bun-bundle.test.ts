/**
 * @file scripts/buntest/bun-bundle.test.ts
 * @description This file contains the tests for bundle.
 * @author Luca Liguori
 */

/* oxlint-disable import/no-namespace -- spyOn needs the namespaces to intercept the named imports of bun-bundle.mjs */

import { afterAll, afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from 'bun:test';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { main } from '../bun-bundle.mjs';

const log = spyOn(console, 'log').mockImplementation(() => {});
const warn = spyOn(console, 'warn').mockImplementation(() => {});
const error = spyOn(console, 'error').mockImplementation(() => {});

// The tsc declaration build is mocked: the tests write the declarations it would emit.
const spawnSync = spyOn(childProcess, 'spawnSync').mockReturnValue({ status: 0 } as ReturnType<typeof childProcess.spawnSync>);

// The watcher is mocked: the tests call the change callback it would receive.
let onChange: () => void = () => {};
const watch = spyOn(fs, 'watch').mockImplementation(((_dir: string, _options: unknown, callback: () => void) => {
  onChange = callback;
}) as unknown as typeof fs.watch);

let root: string;

/**
 * Create a file, and its parent directories, inside the temporary root.
 *
 * @param {string} file Path relative to the root.
 * @param {string | object} content File content, objects are written as JSON.
 */
function write(file: string, content: string | object): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), typeof content === 'string' ? content : JSON.stringify(content));
}

/**
 * Read a file inside the temporary root.
 *
 * @param {string} file Path relative to the root.
 * @returns {string} The file content.
 */
function read(file: string): string {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

/**
 * Check whether a path exists inside the temporary root.
 *
 * @param {string} file Path relative to the root.
 * @returns {boolean} True when the path exists.
 */
function exists(file: string): boolean {
  return fs.existsSync(path.join(root, file));
}

/**
 * Wait for the next call of a console spy.
 *
 * @param {Mock<(...args: unknown[]) => void>} spy The console spy.
 * @returns {Promise<unknown>} The first argument of the call.
 */
async function nextCall(spy: Mock<(...args: unknown[]) => void>): Promise<unknown> {
  return new Promise((resolve) => spy.mockImplementationOnce((value: unknown) => resolve(value)));
}

/**
 * Write a package whose `.` export is bundled from src/index.ts.
 *
 * @param {string} dir Package directory relative to the root.
 * @param {string} name Package name.
 * @param {string} source Content of src/index.ts.
 * @param {object} [extra] Extra package.json fields.
 */
function writePackage(dir: string, name: string, source: string, extra: object = {}): void {
  write(path.join(dir, 'package.json'), { name, exports: { '.': { bun: './src/index.ts', import: './dist/index.js' } }, ...extra });
  write(path.join(dir, 'src/index.ts'), source);
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'bundle-test-')));
  log.mockClear();
  warn.mockClear();
  error.mockClear();
  spawnSync.mockClear();
  watch.mockClear();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  log.mockRestore();
  warn.mockRestore();
  error.mockRestore();
  spawnSync.mockRestore();
  watch.mockRestore();
});

describe('bun-bundle.mjs', () => {
  test('should print the version when called with --version or -v', async () => {
    for (const flag of ['--version', '-v']) {
      expect(await main([flag], root)).toBe(0);
    }
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+$/));
  });

  test('should print the help when called with --help or -h', async () => {
    for (const flag of ['--help', '-h']) {
      expect(await main([flag], root)).toBe(0);
    }
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  test('should list the bundles without building or writing anything with --dry-run or -n', async () => {
    writePackage('.', 'fixture', 'export const value = 1;');
    for (const flag of ['--dry-run', '-n']) {
      expect(await main([flag], root)).toBe(0);
    }
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[dry-run] Would bundle'));
    expect(spawnSync).not.toHaveBeenCalled();
    expect(exists('build')).toBe(false);
  });

  test('should bundle every export, expanding nested wildcards, with sourcemaps in development', async () => {
    writePackage('.', 'fixture', "import { basename } from 'node:path';\nimport { helper } from './helper.ts';\nexport const value = helper(basename('/a/b'));", {
      exports: {
        '.': { bun: './src/index.ts', import: './dist/index.js' },
        './namespaces/*': { bun: './src/namespaces/*.ts', import: './dist/namespaces/*.js' },
        './missing/*': { bun: './src/missing/*.ts', import: './dist/missing/*.js' },
        './flat': { bun: './src/index.ts', import: './flat.js' },
        './plain': './dist/plain.js',
        './types': { types: './dist/types.d.ts' },
      },
    });
    write('src/helper.ts', 'export const helper = (text: string): string => text.toUpperCase();');
    write('src/namespaces/Alpha.ts', 'export const alpha = 1;');
    write('src/namespaces/nested/Beta.ts', 'export const beta = 2;');
    write('build/stale.js', 'stale');

    expect(await main(['--no-declaration-build'], root)).toBe(0);
    expect(spawnSync).not.toHaveBeenCalled();
    expect(exists('build/stale.js')).toBe(false);
    expect(exists('build/index.js.map')).toBe(true);
    expect(exists('build/namespaces/Alpha.js')).toBe(true);
    expect(exists('build/namespaces/nested/Beta.js')).toBe(true);
    expect(exists('build/flat.js')).toBe(true);
    expect(exists('build/missing')).toBe(false);
    expect(read('build/index.js')).toMatch(/import \{ basename \} from "(node:)?path"/);
    const output = (await import(pathToFileURL(path.join(root, 'build/index.js')).href)) as { value: string };
    expect(output.value).toBe('B');
    expect(log).toHaveBeenLastCalledWith('Bundled the development exports.');
  });

  test('should bundle and keep external the packages configured in automator.esbuild', async () => {
    writePackage(
      '.',
      'fixture',
      [
        "import { inlined } from 'dep-inline/sub';",
        "import { kept } from '@fixture/kept';",
        "import { both } from 'dep-both';",
        'export const value = [inlined, kept, both];',
      ].join('\n'),
      {
        workspaces: ['packages/*'],
        // external wins over bundle; subpath specifiers name their package; invalid entries are ignored
        automator: { esbuild: { bundle: ['dep-inline/sub', 'dep-both', 7, ''], external: ['@fixture/kept', 'dep-both'] } },
      },
    );
    write('packages/kept/package.json', { name: '@fixture/kept' });
    write('node_modules/dep-inline/package.json', { name: 'dep-inline', type: 'module', exports: { './sub': './sub.js' } });
    write('node_modules/dep-inline/sub.js', "export const inlined = 'inlined';");

    expect(await main(['--no-declaration-build'], root)).toBe(0);
    const javascript = read('build/index.js');
    expect(javascript).not.toMatch(/from "dep-inline/);
    expect(javascript).toContain('var inlined = "inlined"');
    expect(javascript).toContain('from "@fixture/kept"');
    expect(javascript).toContain('from "dep-both"');
    expect(log).toHaveBeenCalledWith('Automator: bundle dep-inline, dep-both, external @fixture/kept, dep-both.');

    // Fields that are not lists configure nothing
    log.mockClear();
    writePackage('.', 'fixture', 'export const value = 42;', { automator: { esbuild: { bundle: 'dep-inline', external: null } } });
    expect(await main(['--no-declaration-build'], root)).toBe(0);
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('Automator:'));
  });

  test('should minify without sourcemaps in production', async () => {
    writePackage('.', 'fixture', 'export const value = 42;');
    expect(await main(['--production', '--no-declaration-build'], root)).toBe(0);
    expect(exists('build/index.js')).toBe(true);
    expect(exists('build/index.js.map')).toBe(false);
    expect(log).toHaveBeenLastCalledWith('Bundled the production exports.');
  });

  test('should build the declarations first and bundle them with the workspace types inlined', async () => {
    write('package.json', {
      name: 'fixture',
      workspaces: ['packages/*'],
      exports: { '.': { bun: './src/index.ts', import: './dist/index.js', types: './dist/index.d.ts' } },
    });
    write('src/index.ts', "export { one } from '@fixture/one';\nexport { external } from 'external-package';");
    write(
      'dist/index.d.ts',
      [
        "export type { One } from '@fixture/one';",
        "export type { Sub } from '@fixture/one/sub';",
        "export type { Item } from '@fixture/one/items/item';",
        "export type { Deep } from '@fixture/one/items/deep/leaf';",
        "export type { Two } from '@fixture/two';",
        "export type { Three } from '@fixture/three';",
        "export type { Four } from '@fixture/four';",
        "export type { External } from 'external-package';",
        "export * from './circular';",
        'export interface Root { name: string }',
      ].join('\n'),
    );
    write('dist/circular.d.ts', "import type { Root } from './index';\nexport interface Circular { root: Root }");
    writePackage('packages/one', '@fixture/one', 'export const one = 1;', {
      exports: {
        '.': { bun: './src/index.ts', import: './dist/index.js', types: './dist/index.d.ts' },
        './sub': './dist/sub.js',
        './items/*': { import: './dist/items/*.js', types: './dist/items/*.d.ts' },
        './items/deep/*': { import: './dist/deep/*.js', types: './dist/deep/*.d.ts' },
      },
    });
    write('packages/one/dist/index.d.ts', 'export interface One { one: number }');
    write('packages/one/dist/items/item.d.ts', 'export interface Item { item: number }');
    write('packages/one/dist/deep/leaf.d.ts', 'export interface Deep { deep: number }');
    write('packages/two/package.json', { name: '@fixture/two', types: './index.d.ts' });
    write('packages/two/index.d.ts', 'export interface Two { two: number }');
    write('packages/three/package.json', { name: '@fixture/three', exports: { '.': { types: './missing.d.ts' } } });
    write('packages/four/package.json', { name: '@fixture/four' }); // A workspace that is not installed in node_modules
    fs.mkdirSync(path.join(root, 'node_modules/@fixture'), { recursive: true });
    for (const name of ['one', 'two', 'three']) {
      fs.symlinkSync(path.join(root, 'packages', name), path.join(root, 'node_modules/@fixture', name), 'junction');
    }

    expect(await main([], root)).toBe(0);
    expect(spawnSync).toHaveBeenCalledWith('bun', ['run', 'cleanBuildDts'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    const javascript = read('build/index.js');
    expect(javascript).not.toContain('@fixture/one');
    expect(javascript).toContain('from "external-package"');
    const declarations = read('build/index.d.ts');
    expect(declarations).toContain('interface One');
    expect(declarations).toContain('interface Two');
    // Subpath patterns resolve, the longest matching prefix winning
    expect(declarations).toContain('interface Item');
    expect(declarations).toContain('interface Deep');
    expect(declarations).not.toContain('@fixture/one/items');
    expect(declarations).toContain('interface Circular');
    expect(declarations).toContain("from 'external-package'");
    expect(declarations).toContain("from '@fixture/four'");
  });

  test('should fail when the declaration build fails or a declaration entry is missing', async () => {
    writePackage('.', 'fixture', 'export const value = 42;', { exports: { '.': { bun: './src/index.ts', import: './dist/index.js', types: './dist/index.d.ts' } } });
    write('build/keep.js', 'keep');
    spawnSync.mockReturnValueOnce({ status: 1 } as ReturnType<typeof childProcess.spawnSync>);
    expect(main([], root)).rejects.toThrow('"bun run cleanBuildDts" failed with exit code 1.');
    spawnSync.mockReturnValueOnce({ status: null } as ReturnType<typeof childProcess.spawnSync>);
    expect(main([], root)).rejects.toThrow('"bun run cleanBuildDts" failed with exit code unknown.');
    expect(read('build/keep.js')).toBe('keep');
    expect(main([], root)).rejects.toThrow(`Declaration entry not found: ${path.join(root, 'dist/index.d.ts')}.`);
  });

  test('should fail when a source cannot be bundled', async () => {
    writePackage('.', 'fixture', 'export const invalid = ;');
    expect(main(['--no-declaration-build'], root)).rejects.toThrow(`Failed to bundle ${path.join('src', 'index.ts')}.`);
  });

  test('should skip the packages without bundleable exports and keep their output', async () => {
    write('package.json', { name: 'fixture', workspaces: ['packages/*'] });
    write('packages/empty/package.json', { name: '@fixture/empty', exports: './dist/index.js' });
    write('build/keep.js', 'keep');
    expect(await main(['--no-declaration-build', '--workspaces'], root)).toBe(0);
    expect(warn).toHaveBeenCalledWith('No bundleable exports found in ., skipping.');
    expect(warn).toHaveBeenCalledWith(`No bundleable exports found in ${path.join('packages', 'empty')}, skipping.`);
    expect(read('build/keep.js')).toBe('keep');
  });

  test('should bundle every workspace once, in declaration order, with --workspaces', async () => {
    write('package.json', { name: 'fixture', workspaces: { packages: ['packages/zeta', 'packages/*', 'missing/*'] } });
    writePackage('packages/alpha', '@fixture/alpha', 'export const alpha = 1;');
    writePackage('packages/zeta', '@fixture/zeta', 'export const zeta = 1;');
    write('packages/no-manifest/src/index.ts', 'export const skip = 1;');
    expect(await main(['--no-declaration-build', '--workspaces'], root)).toBe(0);
    const outputs = log.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('index.js'));
    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toContain(path.join('packages', 'zeta', 'build', 'index.js'));
    expect(outputs[1]).toContain(path.join('packages', 'alpha', 'build', 'index.js'));
    expect(exists('packages/no-manifest/build')).toBe(false);

    write('package.json', { name: 'fixture' });
    expect(await main(['--no-declaration-build', '--workspaces'], root)).toBe(0);
  });

  test('should rebuild the JavaScript on change with --watch and recover from a failed rebuild', async () => {
    write('package.json', { name: 'fixture', workspaces: ['packages/*'] });
    writePackage('packages/one', '@fixture/one', 'export const value = 1;');
    write('packages/no-src/package.json', { name: '@fixture/no-src', exports: './dist/index.js' });
    expect(await main(['--no-declaration-build', '--workspaces', '--watch'], root)).toBe(0);
    expect(watch).toHaveBeenCalledTimes(1);
    expect(watch).toHaveBeenCalledWith(path.join(root, 'packages/one/src'), { recursive: true }, expect.any(Function));
    expect(log).toHaveBeenLastCalledWith('Watching for changes...');

    write('packages/one/src/index.ts', 'export const invalid = ;');
    const failed = nextCall(error);
    onChange();
    onChange(); // The rebuild is debounced
    expect(await failed).toBeInstanceOf(AggregateError);

    write('packages/one/src/index.ts', 'export const value = 2;');
    const rebuilt = nextCall(log);
    onChange();
    expect(String(await rebuilt)).toContain(path.join('packages', 'one', 'build', 'index.js'));
    expect(read('packages/one/build/index.js')).toContain('value = 2');
    expect(spawnSync).not.toHaveBeenCalled();
  });
});
