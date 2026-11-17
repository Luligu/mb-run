/**
 * @file scripts/buntest/esbuild.test.ts
 * @description This file contains the tests for esbuild.
 * @author Luca Liguori
 */

/* oxlint-disable import/no-namespace -- spyOn needs the namespace to intercept named exports of esbuild */

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as esbuild from 'esbuild';

import { main } from '../esbuild.mjs';

const log = spyOn(console, 'log').mockImplementation(() => {});
const error = spyOn(console, 'error').mockImplementation(() => {});

let root: string;

/**
 * Create a file, and its parent directories, inside the temporary root.
 *
 * @param {string} file - Path relative to the root.
 * @param {string} [content] - File content.
 */
function write(file: string, content = ''): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content, 'utf8');
}

/**
 * Read a file inside the temporary root.
 *
 * @param {string} file - Path relative to the root.
 * @returns {string} The file content.
 */
function read(file: string): string {
  return readFileSync(path.join(root, file), 'utf8');
}

/**
 * Check whether a path exists inside the temporary root.
 *
 * @param {string} file - Path relative to the root.
 * @returns {boolean} True when the path exists.
 */
function exists(file: string): boolean {
  return existsSync(path.join(root, file));
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'esbuild-test-'));
  log.mockClear();
  error.mockClear();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  log.mockRestore();
  error.mockRestore();
});

describe('esbuild.mjs', () => {
  test('should print the version when called with --version or -v', async () => {
    for (const flag of ['--version', '-v']) {
      expect(await main([flag])).toBe(0);
    }
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+$/));
  });

  test('should print the help when called with --help or -h', async () => {
    for (const flag of ['--help', '-h']) {
      expect(await main([flag])).toBe(0);
    }
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  test('should reject unknown arguments including --dryrun', async () => {
    expect(await main(['--unknown'])).toBe(1);
    expect(error).toHaveBeenCalledWith('Unknown argument: --unknown. Run with --help for usage.');

    expect(await main(['--dryrun'])).toBe(1);
    expect(error).toHaveBeenCalledWith('Unknown argument: --dryrun. Run with --help for usage.');

    expect(await main(['--foo', '--bar'])).toBe(1);
    expect(error).toHaveBeenCalledWith('Unknown arguments: --foo, --bar. Run with --help for usage.');
  });

  test('should reject when --external is missing a value', async () => {
    expect(await main(['--external'])).toBe(1);
    expect(error).toHaveBeenCalledWith('Missing value for --external. Run with --help for usage.');

    expect(await main(['--external', '--obfuscate'])).toBe(1);
    expect(error).toHaveBeenCalledWith('Missing value for --external. Run with --help for usage.');

    expect(await main(['--external='])).toBe(1);
    expect(error).toHaveBeenCalledWith('Missing value for --external. Run with --help for usage.');
  });

  test('should reject when --entry-points is missing a value', async () => {
    expect(await main(['--entry-points'])).toBe(1);
    expect(error).toHaveBeenCalledWith('Missing value for --entry-points. Run with --help for usage.');

    expect(await main(['--entry-points', '--declaration'])).toBe(1);
    expect(error).toHaveBeenCalledWith('Missing value for --entry-points. Run with --help for usage.');

    expect(await main(['--entry-points='])).toBe(1);
    expect(error).toHaveBeenCalledWith('Missing value for --entry-points. Run with --help for usage.');
  });

  test('should reject when no dist directories are provided', async () => {
    expect(await main([])).toBe(1);
    expect(error).toHaveBeenCalledWith('Missing dist directory. Run with --help for usage.');
  });

  test('should fail when distDir is not a directory or does not exist', async () => {
    write('not-a-dir.txt', 'file content');
    expect(await main([path.join(root, 'not-a-dir.txt')])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Not a directory:'));

    expect(await main([path.join(root, 'does-not-exist')])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Not a directory:'));
  });

  test('should fail when distDir is missing entry points', async () => {
    mkdirSync(path.join(root, 'empty-dist'));
    expect(await main([path.join(root, 'empty-dist')])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Missing entry point (module.js, main.js, cli.js) in'));
  });

  test('should simulate bundling without writing or removing files with --dry-run or -n', async () => {
    const flags = ['--dry-run', '-n'];
    for (const flag of flags) {
      const dist = `dist-${flag.replace(/^-+/, '')}`;
      write(`${dist}/module.js`, 'export const msg = "original module";');
      write(`${dist}/cli.js`, 'console.log("original cli");');
      write(`${dist}/module.d.ts`, 'export declare const msg: string;');
      write(`${dist}/cli.d.ts`, 'export declare const cli: void;');
      write(`${dist}/extra.js`, 'export const extra = 1;');
      write(`${dist}/extra.js.map`, 'extra js map');
      write(`${dist}/extra.d.ts`, 'export declare const extra: number;');
      write(`${dist}/extra.d.ts.map`, 'extra dts map');
      write(`${dist}/sub/nested.js`, 'export const nested = true;');
      write(`${dist}/sub/nested.d.ts.map`, 'nested dts map');
      write(`${dist}/info.json`, '{"test":true}');

      log.mockClear();
      expect(await main([flag, '--obfuscate', '--declaration', path.join(root, dist)])).toBe(0);

      // Verify files were not modified or deleted
      expect(read(`${dist}/module.js`)).toBe('export const msg = "original module";');
      expect(exists(`${dist}/extra.js`)).toBe(true);
      expect(exists(`${dist}/extra.js.map`)).toBe(true);
      expect(exists(`${dist}/extra.d.ts`)).toBe(true);
      expect(exists(`${dist}/extra.d.ts.map`)).toBe(true);
      expect(exists(`${dist}/sub/nested.js`)).toBe(true);
      expect(exists(`${dist}/info.json`)).toBe(true);

      // Verify dry-run logs
      const logs = log.mock.calls.map((call) => String(call[0]));
      expect(logs.some((line) => line.includes('[dry-run] Would bundle') && line.includes('module.js'))).toBe(true);
      expect(logs.some((line) => line.includes('[dry-run] Would obfuscate') && line.includes('module.js'))).toBe(true);
      expect(logs.some((line) => line.includes('[dry-run] Would bundle declarations for') && line.includes('module.d.ts'))).toBe(true);
      expect(logs.some((line) => line.includes('[dry-run] Would remove') && line.includes('extra.js'))).toBe(true);
      expect(logs.some((line) => line.includes('[dry-run] done:') && line.includes('would remove: 6'))).toBe(true);
    }
  });

  test('should bundle package with module.js using real esbuild, remove maps and extra artifacts, and keep non-js/non-dts files', async () => {
    write('dist/module.js', 'export const answer = 42;');
    write('dist/module.d.ts', 'export declare const answer: number;');
    write('dist/module.js.map', 'map');
    write('dist/module.d.ts.map', 'dts map');
    write('dist/extra.js', 'export const unused = "unused";');
    write('dist/extra.d.ts', 'export declare const unused: string;');
    write('dist/sub/nested.js', 'export const nested = true;');
    write('dist/sub/nested.js.map', 'nested map');
    write('dist/readme.txt', 'readme documentation');

    expect(await main([path.join(root, 'dist')])).toBe(0);

    const bundled = read('dist/module.js');
    expect(bundled).toContain('42');
    expect(bundled).toContain('export');
    expect(exists('dist/module.d.ts')).toBe(false);
    expect(exists('dist/readme.txt')).toBe(true);

    expect(exists('dist/module.js.map')).toBe(false);
    expect(exists('dist/module.d.ts.map')).toBe(false);
    expect(exists('dist/extra.js')).toBe(false);
    expect(exists('dist/extra.d.ts')).toBe(false);
    expect(exists('dist/sub/nested.js')).toBe(false);
    expect(exists('dist/sub/nested.js.map')).toBe(false);
  });

  test('should bundle app with main.js and cli.js, and bundle internal dependencies with --bundle-deps', async () => {
    write('dist/helper.js', 'export const helper = (x) => x * 2;');
    write('dist/main.js', 'import { helper } from "./helper.js"; export const value = helper(21);');
    write('dist/cli.js', 'console.log("running cli");');

    expect(await main(['--bundle-deps', path.join(root, 'dist')])).toBe(0);

    const mainCode = read('dist/main.js');
    expect(mainCode).toContain('value');
    expect(exists('dist/cli.js')).toBe(true);
    expect(exists('dist/helper.js')).toBe(false);
  });

  test('should obfuscate output with real javascript-obfuscator when --obfuscate is passed', async () => {
    write('dist/module.js', 'export const secretKey = "super_secret_payload_value";');

    expect(await main(['--obfuscate', path.join(root, 'dist')])).toBe(0);

    const obfuscated = read('dist/module.js');
    expect(obfuscated).not.toContain('super_secret_payload_value');
    expect(obfuscated).toMatch(/_0x[a-f0-9]+/);
  });

  test('should bundle declarations with real rollup when --declaration is passed, keeping all package imports external and inlining local types', async () => {
    write('dist/types.d.ts', 'export interface LocalType { active: boolean; }');
    write('dist/module.js', 'export const val = 1;');
    write('dist/module.d.ts', 'import type { LocalType } from "./types.js"; import type { AnsiLogger } from "node-ansi-logger"; export declare const val: LocalType & AnsiLogger;');

    expect(await main(['--declaration', path.join(root, 'dist')])).toBe(0);

    const dtsContent = read('dist/module.d.ts');
    expect(dtsContent).toContain('interface LocalType');
    expect(dtsContent).not.toContain('./types');
    expect(dtsContent).toContain('declare const val: LocalType & AnsiLogger;');
    expect(dtsContent).toContain("from 'node-ansi-logger';");
  });

  test('should bundle custom entry points when --entry-points is specified', async () => {
    write('dist/index.js', 'export const index = true;');
    write('dist/worker.js', 'export const worker = true;');
    write('dist/unused.js', 'export const unused = false;');

    expect(await main(['--entry-points', 'index.js, worker.js', '--entry-points=extra.js', path.join(root, 'dist')])).toBe(0);

    expect(exists('dist/index.js')).toBe(true);
    expect(exists('dist/worker.js')).toBe(true);
    expect(exists('dist/unused.js')).toBe(false);

    expect(await main(['--entry-points=missing.js', path.join(root, 'dist')])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Missing entry point (missing.js) in'));
  });

  test('should respect custom --external list for both esbuild and rollup declarations with --bundle-deps', async () => {
    write('dist/module.js', 'import { foo } from "custom-pkg"; import { bar } from "wildcard-pkg/sub"; export const val = foo + bar;');
    write(
      'dist/module.d.ts',
      'import type { Buffer } from "node:buffer"; import type { Foo } from "custom-pkg"; import type { Bar } from "wildcard-pkg/sub"; export declare const val: Foo & Bar & Buffer;',
    );

    expect(await main(['--bundle-deps', '--external', 'custom-pkg, wildcard-pkg/*', '--external=another-pkg', '--declaration', path.join(root, 'dist')])).toBe(0);

    const bundledJs = read('dist/module.js');
    expect(bundledJs).toContain('custom-pkg');
    expect(bundledJs).toContain('wildcard-pkg/sub');

    const dtsContent = read('dist/module.d.ts');
    expect(dtsContent).toContain("from 'node:buffer';");
    expect(dtsContent).toContain("from 'custom-pkg';");
    expect(dtsContent).toContain("from 'wildcard-pkg/sub';");
  });

  test('should process multiple dist directories', async () => {
    write('dist1/module.js', 'export const a = 1;');
    write('dist2/main.js', 'export const b = 2;');

    expect(await main([path.join(root, 'dist1'), path.join(root, 'dist2')])).toBe(0);

    const logs = log.mock.calls.map((call) => String(call[0]));
    expect(logs[0]).toContain('[esbuild] processing 2 dist directories;');
    expect(read('dist1/module.js')).toContain('1');
    expect(read('dist2/main.js')).toContain('2');
  });

  test('should fail and report when esbuild fails with syntax error', async () => {
    write('dist/module.js', 'const broken = ;');

    expect(await main([path.join(root, 'dist')])).toBe(1);
    expect(error).toHaveBeenCalled();
  });

  test('should fail when esbuild produces no output files', async () => {
    write('dist/module.js', 'export const a = 1;');
    const buildSpy = spyOn(esbuild, 'build').mockResolvedValueOnce({
      outputFiles: [],
    } as unknown as Awaited<ReturnType<typeof esbuild.build>>);

    expect(await main([path.join(root, 'dist')])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('esbuild produced no output for'));
    buildSpy.mockRestore();
  });

  test('should fail and report when an error is not an Error instance', async () => {
    write('dist/module.js', 'export const a = 1;');
    const buildSpy = spyOn(esbuild, 'build').mockRejectedValueOnce('build crash');

    expect(await main([path.join(root, 'dist')])).toBe(1);
    expect(error).toHaveBeenCalledWith('build crash');
    buildSpy.mockRestore();
  });
});
