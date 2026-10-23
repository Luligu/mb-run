/**
 * @file scripts/buntest/version.test.ts
 * @description This file contains the tests for version.
 * @author Luca Liguori
 */

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
// oxlint-disable-next-line import/no-namespace -- spyOn needs the namespace to intercept the named imports of version.mjs
import * as childProcess from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { main } from '../version.mjs';

const log = spyOn(console, 'log').mockImplementation(() => {});
const error = spyOn(console, 'error').mockImplementation(() => {});
const execFileSync = spyOn(childProcess, 'execFileSync').mockReturnValue('ABC1234\n');

let root: string;

/**
 * Read the version from the temporary package.json.
 *
 * @returns {string} The version.
 */
function readVersion(): string {
  return (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'version-test-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.2.3' }));
  log.mockClear();
  error.mockClear();
  execFileSync.mockClear();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  log.mockRestore();
  error.mockRestore();
  execFileSync.mockRestore();
});

describe('version.mjs', () => {
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
    expect(execFileSync).not.toHaveBeenCalled();
  });

  test('should reject unknown options, a missing tag and an invalid tag', async () => {
    expect(await main(['dev', '--typo'], root)).toBe(1);
    expect(error).toHaveBeenCalledWith('Unknown option(s): --typo');
    expect(await main([], root)).toBe(1);
    expect(await main(['nightly'], root)).toBe(1);
    expect(error).toHaveBeenCalledWith('Missing or invalid parameter (expected dev, edge, git, local, or bun).');
    expect(execFileSync).not.toHaveBeenCalled();
    expect(readVersion()).toBe('1.2.3');
  });

  test('should print the next version without writing it with --dry-run or -n', async () => {
    for (const flag of ['--dry-run', '-n']) {
      expect(await main([flag, 'DEV'], root)).toBe(0);
    }
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[dry-run\] package\.json version: 1\.2\.3 -> 1\.2\.3-dev-\d{8}-abc1234$/));
    expect(readVersion()).toBe('1.2.3');
  });

  test('should write the next version for every supported tag', async () => {
    for (const tag of ['dev', 'edge', 'git', 'local', 'bun']) {
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
      expect(await main([tag], root)).toBe(0);
      expect(readVersion()).toMatch(new RegExp(`^1\\.2\\.3-${tag}-\\d{8}-abc1234$`));
    }
    expect(execFileSync).toHaveBeenCalledWith('git', ['rev-parse', '--short=7', 'HEAD'], expect.objectContaining({ cwd: root }));
    expect(readFileSync(path.join(root, 'package.json'), 'utf8')).toEndWith('}\n');
  });

  test('should reject a version that is not plain x.y.z', async () => {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3-dev' }));
    expect(main(['dev'], root)).rejects.toThrow('package.json version must be plain x.y.z (got: "1.2.3-dev")');
    writeFileSync(path.join(root, 'package.json'), '{}');
    expect(main(['dev'], root)).rejects.toThrow('package.json version must be plain x.y.z (got: "")');
  });

  test('should reject when git fails or returns an unexpected SHA', async () => {
    execFileSync.mockImplementationOnce(() => {
      throw new Error('not a git repository');
    });
    expect(main(['dev'], root)).rejects.toThrow('Unable to determine git short SHA. (not a git repository)');
    execFileSync.mockImplementationOnce(() => {
      // oxlint-disable-next-line only-throw-error -- Git failures are not always Error instances
      throw 'fatal';
    });
    expect(main(['dev'], root)).rejects.toThrow('Unable to determine git short SHA. (fatal)');
    execFileSync.mockReturnValueOnce('nope');
    expect(main(['dev'], root)).rejects.toThrow('Unexpected git short SHA output: "nope"');
    expect(readVersion()).toBe('1.2.3');
  });
});
