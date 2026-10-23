/**
 * @file scripts/buntest/deep-clean.test.ts
 * @description This file contains the tests for deep-clean.
 * @author Luca Liguori
 */

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
// oxlint-disable-next-line import/no-namespace -- spyOn needs the namespace to intercept the named imports of deep-clean.mjs
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { main } from '../deep-clean.mjs';

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
  root = fs.mkdtempSync(path.join(tmpdir(), 'deep-clean-test-'));
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

describe('deep-clean.mjs', () => {
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
    write('bun.lock');
    expect(main(['--typo'], root)).toBe(1);
    expect(error).toHaveBeenCalledWith('Unknown argument: --typo. Run with --help for usage.');
    expect(main(['--typo', '-x'], root)).toBe(1);
    expect(error).toHaveBeenCalledWith('Unknown arguments: --typo, -x. Run with --help for usage.');
    expect(exists('bun.lock')).toBe(true);
  });

  test('should report nothing to clean when there is nothing to remove', () => {
    write('src/index.ts');
    fs.mkdirSync(path.join(root, 'node_modules'));
    expect(main([], root)).toBe(0);
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^Nothing to clean in \d+ms\.$/));
    expect(exists('src/index.ts')).toBe(true);
    expect(exists('node_modules')).toBe(true);
  });

  test('should remove the outputs and lock files and empty .cache and node_modules at the root', () => {
    const targets = ['tsconfig.tsbuildinfo', 'dist/a', 'build/a', 'coverage/a', 'jest/a', 'temp/a', 'bun.lock', 'package-lock.json', 'npm-shrinkwrap.json'];
    for (const target of targets) write(target);
    write('.cache/one');
    write('node_modules/one/index.js');
    write('node_modules/.bin/two');
    write('src/index.ts');
    expect(main([], root)).toBe(0);
    for (const target of targets) expect(exists(target.split('/')[0])).toBe(false);
    expect(exists('.cache')).toBe(true);
    expect(fs.readdirSync(path.join(root, '.cache'))).toEqual([]);
    expect(exists('node_modules')).toBe(true);
    expect(fs.readdirSync(path.join(root, 'node_modules'))).toEqual([]);
    expect(exists('src/index.ts')).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('.cache/* (1 entry)'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('node_modules/* (2 entries)'));
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^Cleaned 12 paths in \d+ms\.$/));
  });

  test('should list the paths without removing them with --dry-run or -n', () => {
    write('dist/index.js');
    write('package-lock.json');
    write('node_modules/one/index.js');
    for (const flag of ['--dry-run', '-n']) {
      expect(main([flag], root)).toBe(0);
    }
    expect(exists('dist/index.js')).toBe(true);
    expect(exists('package-lock.json')).toBe(true);
    expect(exists('node_modules/one/index.js')).toBe(true);
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^Dry run: would clean 3 paths in \d+ms\.$/));
  });

  test('should leave the workspaces untouched without --workspaces', () => {
    write('package.json', JSON.stringify({ workspaces: ['packages/*'] }));
    write('packages/one/package.json', '{}');
    write('packages/one/node_modules/a');
    expect(main([], root)).toBe(0);
    expect(exists('packages/one/node_modules/a')).toBe(true);
  });

  test('should remove .cache and node_modules entirely in the workspaces listed as paths and globs', () => {
    write('package.json', JSON.stringify({ workspaces: ['apps/app', 'packages/*', 'missing', 'missing/*'] }));
    write('apps/app/package.json', '{}');
    write('apps/app/.cache/a');
    write('packages/one/package.json', '{}');
    write('packages/one/node_modules/a');
    write('packages/one/package-lock.json');
    write('packages/no-manifest/node_modules/a');
    write('packages/file.txt');
    expect(main(['--workspaces'], root)).toBe(0);
    expect(exists('apps/app/.cache')).toBe(false);
    expect(exists('packages/one/node_modules')).toBe(false);
    expect(exists('packages/one/package-lock.json')).toBe(false);
    expect(exists('packages/one/package.json')).toBe(true);
    expect(exists('packages/no-manifest/node_modules/a')).toBe(true);
    expect(exists('packages/file.txt')).toBe(true);
    expect(log).toHaveBeenCalledWith(path.join('packages', 'one'));
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^Cleaned 3 paths in \d+ms\.$/));
  });

  test('should read the object form of workspaces and accept a package.json without workspaces', () => {
    write('package.json', JSON.stringify({ workspaces: { packages: ['packages/*'] } }));
    write('packages/one/package.json', '{}');
    write('packages/one/bun.lock');
    expect(main(['--workspaces'], root)).toBe(0);
    expect(exists('packages/one/bun.lock')).toBe(false);

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
    write('dist/a');
    write('build/a');
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
    write('dist/a');
    const rmSync = spyOn(fs, 'rmSync');
    for (const code of ['EPERM', 'EBUSY', 'ENOTEMPTY']) {
      rmSync.mockImplementationOnce(() => {
        throw Object.assign(new Error('Locked'), { code });
      });
      expect(main([], root)).toBe(0);
      expect(warn).toHaveBeenLastCalledWith(`Skipped locked path (${code}): dist — likely held by a running process.`);
    }
    write('node_modules/one/index.js');
    rmSync.mockImplementation(() => {
      throw Object.assign(new Error('Locked'), { code: 'EBUSY' });
    });
    expect(main([], root)).toBe(0);
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^Nothing to clean in \d+ms\.$/));
    rmSync.mockRestore();
    expect(exists('node_modules/one')).toBe(true);
  });

  test('should throw when removing a path fails with an unexpected error', () => {
    write('dist/a');
    const rmSync = spyOn(fs, 'rmSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('I/O error'), { code: 'EIO' });
    });
    expect(() => main([], root)).toThrow('I/O error');
    rmSync.mockRestore();
    expect(exists('dist')).toBe(true);
  });
});
