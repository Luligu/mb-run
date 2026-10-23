/**
 * @file scripts/buntest/clean.test.ts
 * @description This file contains the tests for clean.
 * @author Luca Liguori
 */

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
// oxlint-disable-next-line import/no-namespace -- spyOn needs the namespace to intercept the named imports of clean.mjs
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { main } from '../clean.mjs';

const log = spyOn(console, 'log').mockImplementation(() => {});
const warn = spyOn(console, 'warn').mockImplementation(() => {});
const error = spyOn(console, 'error').mockImplementation(() => {});

let root: string;

/**
 * Create a file, and its parent directories, inside the temporary root.
 *
 * @param {string} file Path relative to the root.
 * @param {string} [content] File content.
 */
function write(file: string, content = ''): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
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

beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), 'clean-test-'));
  log.mockClear();
  warn.mockClear();
  error.mockClear();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  log.mockRestore();
  warn.mockRestore();
  error.mockRestore();
});

describe('clean.mjs', () => {
  test('should print the version when called with --version or -v', () => {
    for (const flag of ['--version', '-v']) {
      expect(main([flag], root)).toBe(0);
    }
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+$/));
  });

  test('should print the help when called with --help or -h', () => {
    for (const flag of ['--help', '-h']) {
      expect(main([flag], root)).toBe(0);
    }
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  test('should reject unknown arguments without cleaning', () => {
    write('dist/index.js');
    expect(main(['--typo'], root)).toBe(1);
    expect(error).toHaveBeenCalledWith('Unknown argument: --typo. Run with --help for usage.');
    expect(main(['--typo', '-x'], root)).toBe(1);
    expect(error).toHaveBeenCalledWith('Unknown arguments: --typo, -x. Run with --help for usage.');
    expect(exists('dist/index.js')).toBe(true);
  });

  test('should report nothing to clean when there is no build output', () => {
    write('src/index.ts');
    expect(main([], root)).toBe(0);
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^Nothing to clean in \d+ms\.$/));
    expect(exists('src/index.ts')).toBe(true);
  });

  test('should remove tsbuildinfo files, dist and build and keep the sources', () => {
    write('tsconfig.tsbuildinfo');
    write('tsconfig.build.tsbuildinfo');
    write('dist/index.js');
    write('build/index.js');
    write('src/index.ts');
    expect(main([], root)).toBe(0);
    expect(exists('tsconfig.tsbuildinfo')).toBe(false);
    expect(exists('tsconfig.build.tsbuildinfo')).toBe(false);
    expect(exists('dist')).toBe(false);
    expect(exists('build')).toBe(false);
    expect(exists('src/index.ts')).toBe(true);
    expect(log).toHaveBeenCalledWith(path.basename(root));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('dist/'));
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^Cleaned 4 paths in \d+ms\.$/));
  });

  test('should list the paths without removing them with --dry-run or -n', () => {
    write('dist/index.js');
    write('tsconfig.tsbuildinfo');
    for (const flag of ['--dry-run', '-n']) {
      expect(main([flag], root)).toBe(0);
    }
    expect(exists('dist/index.js')).toBe(true);
    expect(exists('tsconfig.tsbuildinfo')).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('dist/'));
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^Dry run: would clean 2 paths in \d+ms\.$/));
  });

  test('should leave the workspaces untouched without --workspaces', () => {
    write('package.json', JSON.stringify({ workspaces: ['packages/*'] }));
    write('packages/one/package.json', '{}');
    write('packages/one/dist/index.js');
    expect(main([], root)).toBe(0);
    expect(exists('packages/one/dist')).toBe(true);
  });

  test('should clean the root and the workspaces listed as paths and globs with --workspaces', () => {
    write('package.json', JSON.stringify({ workspaces: ['apps/app', 'packages/*', 'missing', 'missing/*'] }));
    write('apps/app/package.json', '{}');
    write('apps/app/build/index.js');
    write('packages/one/package.json', '{}');
    write('packages/one/dist/index.js');
    write('packages/no-manifest/dist/index.js');
    write('packages/file.txt');
    write('dist/index.js');
    expect(main(['--workspaces'], root)).toBe(0);
    expect(exists('dist')).toBe(false);
    expect(exists('apps/app/build')).toBe(false);
    expect(exists('packages/one/dist')).toBe(false);
    expect(exists('packages/no-manifest/dist')).toBe(true);
    expect(exists('packages/file.txt')).toBe(true);
    expect(log).toHaveBeenCalledWith(path.join('packages', 'one'));
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^Cleaned 3 paths in \d+ms\.$/));
  });

  test('should read the object form of workspaces and accept a package.json without workspaces', () => {
    write('package.json', JSON.stringify({ workspaces: { packages: ['packages/*'] } }));
    write('packages/one/package.json', '{}');
    write('packages/one/dist/index.js');
    expect(main(['--workspaces'], root)).toBe(0);
    expect(exists('packages/one/dist')).toBe(false);

    write('package.json', JSON.stringify({ workspaces: {} }));
    expect(main(['--workspaces'], root)).toBe(0);
    write('package.json', '{}');
    expect(main(['--workspaces'], root)).toBe(0);
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^Nothing to clean in \d+ms\.$/));
  });

  test('should skip a directory that cannot be read', () => {
    write('package.json', JSON.stringify({ workspaces: ['packages/one'] }));
    write('packages/one/package.json', '{}');
    const readdirSync = spyOn(fs, 'readdirSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('Not readable'), { code: 'EACCES' });
    });
    expect(main(['--workspaces'], root)).toBe(0);
    expect(readdirSync).toHaveBeenCalled();
    readdirSync.mockRestore();
  });

  test('should warn and continue when a path cannot be inspected', () => {
    write('dist/index.js');
    write('build/index.js');
    const lstatSync = spyOn(fs, 'lstatSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('Not readable'), { code: 'EACCES', path: 'dist' });
    });
    expect(main([], root)).toBe(0);
    expect(warn).toHaveBeenCalledWith('Skipped unreadable path (EACCES): dist');
    expect(exists('dist')).toBe(true);
    expect(exists('build')).toBe(false);
    lstatSync.mockRestore();
  });

  test('should warn and continue when a path is locked', () => {
    write('dist/index.js');
    write('build/index.js');
    const rmSync = spyOn(fs, 'rmSync');
    for (const code of ['EPERM', 'EBUSY', 'ENOTEMPTY']) {
      rmSync.mockImplementationOnce(() => {
        throw Object.assign(new Error('Locked'), { code });
      });
      expect(main([], root)).toBe(0);
      expect(warn).toHaveBeenLastCalledWith(`Skipped locked path (${code}): dist — likely held by a running process.`);
    }
    rmSync.mockRestore();
    expect(exists('build')).toBe(false);
  });

  test('should throw when removing a path fails with an unexpected error', () => {
    write('dist/index.js');
    const rmSync = spyOn(fs, 'rmSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('I/O error'), { code: 'EIO' });
    });
    expect(() => main([], root)).toThrow('I/O error');
    rmSync.mockRestore();
    expect(exists('dist')).toBe(true);
  });
});
