/**
 * @file scripts/buntest/git-status.test.ts
 * @description This file contains the tests for git-status.
 * @author Luca Liguori
 */

import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
// oxlint-disable-next-line import/no-namespace -- spyOn needs the namespace to intercept the named imports of git-status.mjs
import * as childProcess from 'node:child_process';

import { main } from '../git-status.mjs';

type GitResult = { status: number; stdout?: string; stderr?: string };

const log = spyOn(console, 'log').mockImplementation(() => {});
const error = spyOn(console, 'error').mockImplementation(() => {});

// The git output keyed by the git arguments. Missing commands succeed with no output.
let git: Record<string, GitResult> = {};
// Every git command is mocked, so the tests never read the real repository.
const spawnSync = spyOn(childProcess, 'spawnSync').mockImplementation(((_command: string, args: string[]) => {
  return git[args.join(' ')] ?? { status: 0, stdout: '', stderr: '' };
}) as unknown as typeof childProcess.spawnSync);

/**
 * Get everything printed to the console.
 *
 * @returns {string} The printed lines, joined by newlines.
 */
function output(): string {
  return log.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
}

beforeEach(() => {
  git = {
    'rev-parse --is-inside-work-tree': { status: 0, stdout: 'true\n' },
    'rev-parse --show-toplevel': { status: 0, stdout: '/home/user/repo\n' },
    'branch --show-current': { status: 0, stdout: 'main\n' },
    'rev-parse --short HEAD': { status: 0, stdout: 'abc1234\n' },
    'status --porcelain': { status: 0, stdout: ' M file.ts\n' },
    'count-objects -vH': { status: 0, stdout: 'count: 1\nsize-pack: 2.00 KiB\nno colon here' },
    'rev-list --tags --not --branches --count': { status: 0, stdout: '2' },
    'remote get-url origin': { status: 0, stdout: 'https://github.com/user/repo.git' },
    'ls-remote --tags origin': { status: 0, stdout: 'a\trefs/tags/1.0.0\nb\trefs/tags/1.0.0^{}\n\nc\trefs/heads/main\nd\trefs/tags/2.0.0' },
    'rev-list --objects --all': { status: 0, stdout: 'aaa src/a.ts\nbbb src/b.ts\nccc\n' },
    'cat-file --batch-check=%(objecttype)|%(objectsize)|%(rest)': {
      status: 0,
      stdout: 'blob|2048|src/a.ts\nblob|10|src/b.ts\nblob|10|src/0.ts\ntree|99|src\nblob|5|\n\n',
    },
    'ls-tree -r --long HEAD': { status: 0, stdout: '100644 blob aaa 2048\tsrc/a.ts\n\nnot a tree line\n100644 blob bbb 10\tsrc/b.ts' },
  };
  log.mockClear();
  error.mockClear();
  spawnSync.mockClear();
});

afterAll(() => {
  log.mockRestore();
  error.mockRestore();
  spawnSync.mockRestore();
});

describe('git-status.mjs', () => {
  test('should print the version with --version or -v and the usage with --help or -h', () => {
    for (const flag of ['--version', '-v', '--help', '-h']) {
      expect(main([flag])).toBe(0);
    }
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+$/));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage: node scripts/git-status.mjs [--dry-run|-n] [topN] [remote]'));
    expect(spawnSync).not.toHaveBeenCalled();
  });

  test('should print the options without running the analysis with --dry-run or -n', () => {
    for (const flag of ['--dry-run', '-n']) {
      expect(main([flag, '5', 'upstream'])).toBe(0);
    }
    expect(log).toHaveBeenCalledWith('[dry-run] Would report the repository status (top 5, remote upstream).');
    expect(spawnSync).not.toHaveBeenCalled();
  });

  test('should reject an invalid topN', () => {
    for (const topN of ['0', 'ten']) {
      expect(main([topN])).toBe(1);
      expect(error).toHaveBeenLastCalledWith(expect.stringContaining(`Invalid topN value: "${topN}"`));
    }
  });

  test('should fail outside a git repository', () => {
    git['rev-parse --is-inside-work-tree'] = { status: 128, stderr: 'fatal' };
    expect(main([])).toBe(1);
    expect(error).toHaveBeenCalledWith('Not a git repository.');
  });

  test('should print the full status of a healthy repository', () => {
    expect(main(['1'])).toBe(0);
    const text = output();
    expect(text).toMatch(/Repo:\s+repo/);
    expect(text).toMatch(/Branch:\s+main/);
    expect(text).toMatch(/Dirty:\s+yes/);
    expect(text).toMatch(/count\s+: 1/);
    expect(text).toContain('no colon here');
    expect(text).toContain('Tag-only commits (should be 0): 2');
    expect(text).toContain('Remote tag count (origin): 2');
    expect(text).toContain('fsck: OK');
    expect(text).toMatch(/2048\s+2\.00 KB\s+src\/a\.ts/);
    expect(text).not.toContain('src/b.ts');
    expect(text).toContain('Unique paths ever in history: 2');
  });

  test('should sort equal sizes by path and report the fallbacks of a detached, clean repository', () => {
    git['branch --show-current'] = { status: 0, stdout: '' };
    git['status --porcelain'] = { status: 0, stdout: '' };
    git['rev-list --tags --not --branches --count'] = { status: 1 };
    git['remote get-url upstream'] = { status: 2 };
    expect(main(['30', 'upstream'])).toBe(0);
    const text = output();
    expect(text).toMatch(/Branch:\s+\(detached\)/);
    expect(text).toMatch(/Dirty:\s+no/);
    expect(text).toContain('Tag-only commits (should be 0): 0');
    expect(text).toContain('Remote tag count: (remote not found)');
    expect(text.indexOf('src/0.ts')).toBeLessThan(text.indexOf('src/b.ts'));
  });

  test('should report a failed remote query and print no data for an empty history', () => {
    git['ls-remote --tags origin'] = { status: 2 };
    git['rev-list --objects --all'] = { status: 0, stdout: '' };
    git['cat-file --batch-check=%(objecttype)|%(objectsize)|%(rest)'] = { status: 0, stdout: '' };
    git['ls-tree -r --long HEAD'] = { status: 0, stdout: '' };
    expect(main([])).toBe(0);
    const text = output();
    expect(text).toContain('Remote tag count (origin): (remote query failed)');
    expect(text).toContain('(no data)');
    expect(text).toContain('Unique paths ever in history: 0');
  });

  test('should exit with 2 when the integrity check fails', () => {
    git['fsck --full --no-reflogs'] = { status: 1, stdout: 'broken link', stderr: 'error in tree' };
    expect(main([])).toBe(2);
    expect(output()).toContain('fsck: PROBLEMS FOUND\n\nerror in tree\nbroken link');
    log.mockClear();
    git['fsck --full --no-reflogs'] = { status: 1 };
    expect(main([])).toBe(2);
    expect(output()).toContain('fsck: PROBLEMS FOUND');
    expect(output()).not.toContain('Largest');
  });

  test('should fail with the git output when a required git command fails', () => {
    git['rev-parse --short HEAD'] = { status: 128, stdout: 'out', stderr: 'bad HEAD' };
    expect(main([])).toBe(1);
    expect(error).toHaveBeenCalledWith('git rev-parse --short HEAD failed:\nbad HEAD\nout');
    git['rev-parse --short HEAD'] = { status: 128 };
    expect(main([])).toBe(1);
    expect(error).toHaveBeenCalledWith('git rev-parse --short HEAD failed.');
  });

  test('should report unexpected errors', () => {
    spawnSync.mockImplementationOnce(() => {
      throw new Error('spawnSync git ENOENT');
    });
    expect(main([])).toBe(1);
    expect(error).toHaveBeenCalledWith('spawnSync git ENOENT');
    spawnSync.mockImplementationOnce(() => {
      // oxlint-disable-next-line only-throw-error -- Report errors that are not Error instances too
      throw 'unknown';
    });
    expect(main([])).toBe(1);
    expect(error).toHaveBeenCalledWith('unknown');
  });
});
