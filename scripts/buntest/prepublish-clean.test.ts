/**
 * @file scripts/buntest/prepublish-clean.test.ts
 * @description This file contains the tests for prepublish-clean.
 * @author Luca Liguori
 */

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
// oxlint-disable-next-line import/no-namespace -- spyOn needs the namespace to intercept the named imports of prepublish-clean.mjs
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { main } from '../prepublish-clean.mjs';

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

/**
 * Read a file inside the temporary root.
 *
 * @param {string} file Path relative to the root.
 * @returns {string} The file content.
 */
function read(file: string): string {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), 'prepublish-clean-test-'));
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

describe('prepublish-clean.mjs', () => {
  test('should print the version when called with --version or -v', () => {
    write('package-lock.json');
    for (const flag of ['--version', '-v']) {
      expect(main([flag], root)).toBe(0);
    }
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+$/));
    expect(exists('package-lock.json')).toBe(true);
  });

  test('should print the help when called with --help or -h', () => {
    write('package-lock.json');
    for (const flag of ['--help', '-h']) {
      expect(main([flag], root)).toBe(0);
    }
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    expect(exists('package-lock.json')).toBe(true);
  });


  test('should reject unknown arguments without removing anything', () => {
    write('node_modules/one/index.js');
    write('package-lock.json');
    write('package.json', '{\n  "scripts": {}\n}\n');
    for (const args of [['--dryrun'], ['-n', '--foo'], ['--help', '--bogus'], ['--dry-run=true']]) {
      expect(main(args, root)).toBe(1);
    }
    expect(error).toHaveBeenCalledWith('Unknown argument: --dryrun. Run with --help for usage.');
    expect(error).toHaveBeenCalledTimes(4);
    main(['-x', '-y'], root);
    expect(error).toHaveBeenLastCalledWith('Unknown arguments: -x, -y. Run with --help for usage.');
    expect(log).not.toHaveBeenCalled();
    expect(exists('node_modules/one/index.js')).toBe(true);
    expect(exists('package-lock.json')).toBe(true);
    expect(read('package.json')).toBe('{\n  "scripts": {}\n}\n');
  });

  test('should list what would be removed without removing it with --dry-run or -n', () => {
    write('node_modules/one/index.js');
    write('package-lock.json');
    write('package.json', '{\n  "scripts": {}\n}\n');
    for (const flag of ['--dry-run', '-n']) {
      expect(main([flag], root)).toBe(0);
    }
    expect(log).toHaveBeenCalledWith(expect.stringContaining('node_modules/* (1 entry)'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('package-lock.json'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('package.json: scripts'));
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Dry run: would clean 3 paths in \d+ms\.$/));
    expect(exists('node_modules/one/index.js')).toBe(true);
    expect(exists('package-lock.json')).toBe(true);
    expect(read('package.json')).toBe('{\n  "scripts": {}\n}\n');
  });

  test('should succeed when there is nothing to clean', () => {
    expect(main([], root)).toBe(0);
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^Nothing to clean in \d+ms\.$/));
    write('node_modules/.keep');
    expect(main(['-n'], root)).toBe(0);
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^Dry run: would clean 1 path in \d+ms\.$/));
  });

  test('should empty node_modules, remove the lock files and log them under the root', () => {
    write('node_modules/one/index.js');
    write('node_modules/.bin/two');
    write('package-lock.json');
    write('npm-shrinkwrap.json');
    write('bun.lock');
    write('keep.txt');
    expect(main([], root)).toBe(0);
    expect(fs.readdirSync(path.join(root, 'node_modules'))).toEqual([]);
    expect(exists('package-lock.json')).toBe(false);
    expect(exists('npm-shrinkwrap.json')).toBe(false);
    expect(exists('bun.lock')).toBe(false);
    expect(exists('keep.txt')).toBe(true);
    expect(log).toHaveBeenCalledWith(path.basename(root));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('node_modules/* (2 entries)'));
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^Cleaned 5 paths in \d+ms\.$/));
  });

  test('should delete devDependencies, scripts and automator from package.json and keep the other fields in order', () => {
    write('package.json', JSON.stringify({ name: 'a', scripts: { b: 'c' }, version: '1.0.0', devDependencies: { d: '1' }, automator: {}, dependencies: { e: '1' } }, null, 2) + '\n');
    expect(main([], root)).toBe(0);
    expect(read('package.json')).toBe(JSON.stringify({ name: 'a', version: '1.0.0', dependencies: { e: '1' } }, null, 2) + '\n');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('package.json: devDependencies, scripts, automator'));

    // A second run has nothing left to delete.
    log.mockClear();
    expect(main([], root)).toBe(0);
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^Nothing to clean in \d+ms\.$/));
  });

  test('should keep the package.json format like npm pkg does', () => {
    const cases: [string, string][] = [
      ['{\n\t"name": "a",\n\t"scripts": {}\n}\n', '{\n\t"name": "a"\n}\n'],
      ['{\n    "name": "a",\n    "scripts": {}\n}\n', '{\n    "name": "a"\n}\n'],
      ['{\r\n  "name": "a",\r\n  "scripts": {}\r\n}\r\n', '{\r\n  "name": "a"\r\n}\r\n'],
      ['{\n  "name": "a",\n  "scripts": {}\n}', '{\n  "name": "a"\n}\n'],
      ['{"name":"a","scripts":{}}\n', '{"name":"a"}'],
      ['{\n  "scripts": {}\n}\n', '{}\n'],
    ];
    for (const [before, after] of cases) {
      write('package.json', before);
      expect(main([], root)).toBe(0);
      expect(read('package.json')).toBe(after);
    }
  });

  test('should clean the workspaces listed as paths and globs with --workspaces', () => {
    write('package.json', JSON.stringify({ workspaces: ['apps/app', 'packages/*', 'missing', 'missing/*'], scripts: {} }));
    write('apps/app/package.json', JSON.stringify({ name: 'app', automator: {}, devDependencies: {} }));
    write('apps/app/package-lock.json');
    write('packages/one/package.json', '{}');
    write('packages/one/node_modules/a');
    write('packages/no-manifest/package-lock.json');
    write('packages/file.txt');
    expect(main(['--workspaces'], root)).toBe(0);
    expect(exists('apps/app/package-lock.json')).toBe(false);
    expect(exists('packages/one/node_modules/a')).toBe(false);
    expect(exists('packages/one/node_modules')).toBe(true);
    expect(exists('packages/no-manifest/package-lock.json')).toBe(true);
    // The workspaces are read before the root package.json loses its workspaces field.
    expect(JSON.parse(read('package.json'))).toEqual({});
    expect(JSON.parse(read('apps/app/package.json'))).toEqual({ name: 'app' });
    expect(log).toHaveBeenCalledWith('apps/app');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('package.json: scripts, workspaces'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('package.json: devDependencies, automator'));
  });

  test('should keep the workspaces field and leave the workspaces alone without --workspaces', () => {
    write('package.json', JSON.stringify({ workspaces: ['packages/*'], scripts: {} }));
    write('packages/one/package.json', JSON.stringify({ scripts: {} }));
    write('packages/one/package-lock.json');
    expect(main([], root)).toBe(0);
    expect(JSON.parse(read('package.json'))).toEqual({ workspaces: ['packages/*'] });
    expect(JSON.parse(read('packages/one/package.json'))).toEqual({ scripts: {} });
    expect(exists('packages/one/package-lock.json')).toBe(true);
  });

  test('should read the object form of workspaces and accept a package.json without workspaces', () => {
    write('package.json', JSON.stringify({ workspaces: { packages: ['packages/*'] } }));
    write('packages/one/package.json', '{}');
    write('packages/one/package-lock.json');
    expect(main(['--workspaces'], root)).toBe(0);
    expect(exists('packages/one/package-lock.json')).toBe(false);
    expect(read('package.json')).toBe('{}');

    write('package.json', JSON.stringify({ workspaces: {} }));
    expect(main(['--workspaces'], root)).toBe(0);
    write('package.json', '{}');
    expect(main(['--workspaces'], root)).toBe(0);
  });

  test('should warn and continue when a path is locked', () => {
    write('package-lock.json');
    write('npm-shrinkwrap.json');
    const rmSync = spyOn(fs, 'rmSync');
    for (const code of ['EPERM', 'EBUSY', 'ENOTEMPTY']) {
      rmSync.mockImplementationOnce(() => {
        throw Object.assign(new Error('Locked'), { code, path: 'package-lock.json' });
      });
      expect(main([], root)).toBe(0);
      expect(warn).toHaveBeenLastCalledWith(`Skipped locked path (${code}): package-lock.json — likely held by a running process.`);
    }
    rmSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('Locked'), { code: 'EBUSY' });
    });
    expect(main([], root)).toBe(0);
    expect(warn).toHaveBeenLastCalledWith('Skipped locked path (EBUSY): package-lock.json — likely held by a running process.');
    rmSync.mockRestore();
    expect(exists('npm-shrinkwrap.json')).toBe(false);
  });

  test('should warn and continue instead of blocking the publish when removing a path fails with an unexpected error', () => {
    write('package-lock.json');
    write('bun.lock');
    const rmSync = spyOn(fs, 'rmSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('I/O error'), { code: 'EIO' });
    });
    expect(main([], root)).toBe(0);
    rmSync.mockRestore();
    expect(warn).toHaveBeenCalledWith('Skipped unremovable path (EIO): bun.lock');
    expect(exists('bun.lock')).toBe(true);
    expect(exists('package-lock.json')).toBe(false);
  });

  test('should warn and continue when a path cannot be read', () => {
    write('package-lock.json');
    const lstatSync = spyOn(fs, 'lstatSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('Denied'), { code: 'EACCES', path: 'bun.lock' });
    });
    expect(main([], root)).toBe(0);
    lstatSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('Denied'), { code: 'EACCES' });
    });
    write('package-lock.json');
    expect(main([], root)).toBe(0);
    lstatSync.mockRestore();
    // The first error carries its path, the second falls back to the target name.
    expect(warn).toHaveBeenCalledWith('Skipped unreadable path (EACCES): bun.lock');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(exists('package-lock.json')).toBe(false);
  });

  test('should warn and continue when package.json cannot be read, parsed or written', () => {
    const file = path.join(root, 'package.json');
    write('package.json', '{ "scripts": ');
    expect(main([], root)).toBe(0);
    expect(warn).toHaveBeenLastCalledWith(expect.stringMatching(/^Skipped unreadable package\.json \(.+\): /));

    write('package.json', '{\n  "scripts": {}\n}\n');
    const readFileSync = spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('Denied'), { code: 'EACCES' });
    });
    expect(main([], root)).toBe(0);
    readFileSync.mockRestore();
    expect(warn).toHaveBeenLastCalledWith(`Skipped unreadable package.json (EACCES): ${file}`);

    const writeFileSync = spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('Denied'), { code: 'EACCES' });
    });
    expect(main([], root)).toBe(0);
    writeFileSync.mockRestore();
    expect(warn).toHaveBeenLastCalledWith(`Skipped unwritable package.json (EACCES): ${file}`);
    expect(read('package.json')).toBe('{\n  "scripts": {}\n}\n');
  });
});
