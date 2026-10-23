/**
 * @file scripts/buntest/prune-tags.test.ts
 * @description This file contains the tests for prune-tags.
 * @author Luca Liguori
 */

/* oxlint-disable import/no-namespace -- spyOn needs the namespaces to intercept the named imports of prune-tags.mjs */

import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import * as childProcess from 'node:child_process';
import * as readline from 'node:readline';

import { main } from '../prune-tags.mjs';

type GitResult = { status: number; stdout?: string; stderr?: string };

const log = spyOn(console, 'log').mockImplementation(() => {});
const error = spyOn(console, 'error').mockImplementation(() => {});

let answer = 'y';
const close = mock(() => {});
const createInterface = spyOn(readline, 'createInterface').mockImplementation(
  () => ({ question: (_query: string, callback: (value: string) => void) => callback(answer), close }) as unknown as readline.Interface,
);

// The git output keyed by the git arguments. Missing commands succeed with no output.
let git: Record<string, GitResult> = {};
// Every git command is mocked, so the tests never push to or delete from a real remote.
const spawnSync = spyOn(childProcess, 'spawnSync').mockImplementation(((_command: string, args: string[]) => {
  return git[args.join(' ')] ?? { status: 0, stdout: '', stderr: '' };
}) as unknown as typeof childProcess.spawnSync);

/**
 * Get the git commands run so far.
 *
 * @returns {string[]} The git arguments of every call, joined by spaces.
 */
function gitCommands(): string[] {
  return spawnSync.mock.calls.map((call) => (call[1] as string[]).join(' '));
}

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
    'ls-remote --tags origin': { status: 0, stdout: 'a\trefs/tags/1.0.0\nb\trefs/tags/1.0.0^{}\n\nc\trefs/heads/main\nd\trefs/tags/2.0.0\ne\trefs/tags/2.1.0' },
    'tag': { status: 0, stdout: '2.1.0\n2.0.0\n' },
  };
  answer = 'y';
  log.mockClear();
  error.mockClear();
  close.mockClear();
  spawnSync.mockClear();
});

afterAll(() => {
  log.mockRestore();
  error.mockRestore();
  createInterface.mockRestore();
  spawnSync.mockRestore();
});

describe('prune-tags.mjs', () => {
  test('should print the version with --version or -v and the usage with --help or -h', async () => {
    for (const flag of ['--version', '-v', '--help', '-h']) {
      expect(await main([flag])).toBe(0);
    }
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+$/));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage: node scripts/prune-tags.mjs'));
    expect(spawnSync).not.toHaveBeenCalled();
  });

  test('should reject unknown options and a missing prefix', async () => {
    expect(await main(['--force', '2.'])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown option(s): --force'));
    expect(await main(['--dry-run'])).toBe(1);
    expect(error).toHaveBeenLastCalledWith(expect.stringContaining('Usage: node scripts/prune-tags.mjs'));
    expect(spawnSync).not.toHaveBeenCalled();
  });

  test('should fail outside a git repository', async () => {
    git['rev-parse --is-inside-work-tree'] = { status: 128 };
    expect(await main(['2.'])).toBe(1);
    expect(error).toHaveBeenCalledWith('Not a git repository.');
  });

  test('should stop when the remote has no tags or every tag matches the prefix', async () => {
    git['ls-remote --tags upstream'] = { status: 0, stdout: '' };
    expect(await main(['2.', 'upstream'])).toBe(0);
    expect(output()).toContain("No tags found on remote 'upstream'.");
    git['ls-remote --tags origin'] = { status: 0, stdout: 'a\trefs/tags/2.0.0' };
    expect(await main(['2.'])).toBe(0);
    expect(output()).toContain("No tags to delete. All remote tags already match prefix '2.'.");
    expect(gitCommands().some((command) => command.startsWith('push'))).toBe(false);
  });

  test('should print the planned commands without changes with --dry-run or -n', async () => {
    for (const flag of ['--dry-run', '-n']) {
      expect(await main([flag, '2.'])).toBe(0);
    }
    const text = output();
    expect(text).toContain('git push origin --delete 1.0.0');
    expect(text).toContain('git tag -d 1.0.0');
    expect(text).toContain('git gc --prune=now');
    expect(gitCommands().some((command) => command.startsWith('push'))).toBe(false);
  });

  test('should abort without changes when the user does not confirm', async () => {
    answer = 'n';
    expect(await main(['2.'])).toBe(1);
    expect(output()).toContain('Aborted.');
    expect(close).toHaveBeenCalled();
    expect(gitCommands().some((command) => command.startsWith('push'))).toBe(false);
  });

  test('should delete the tags in batches of 50, then clean up the local tags and the repository', async () => {
    const oldTags = Array.from({ length: 51 }, (_, index) => `0.0.${index}`);
    git['ls-remote --tags origin'] = { status: 0, stdout: oldTags.map((tag) => `x\trefs/tags/${tag}`).join('\n') };
    git[`tag -d ${oldTags.slice(50).join(' ')}`] = { status: 1, stderr: 'tag not found' };
    answer = ' Y ';
    expect(await main(['2.'])).toBe(0);
    const sorted = oldTags.toSorted((left, right) => left.localeCompare(right));
    expect(gitCommands().slice(2)).toEqual([
      `push origin --delete ${sorted.slice(0, 50).join(' ')}`,
      `push origin --delete ${sorted.slice(50).join(' ')}`,
      'fetch --prune --prune-tags',
      `tag -d ${sorted.slice(0, 50).join(' ')}`,
      `tag -d ${sorted.slice(50).join(' ')}`,
      'reflog expire --expire=now --all',
      'gc --prune=now',
      'tag',
    ]);
    expect(output().indexOf('2.0.0')).toBeLessThan(output().lastIndexOf('2.1.0'));

    git.tag = { status: 0, stdout: '' };
    expect(await main(['2.'])).toBe(0);
    expect(output()).toContain('(none)');
  });

  test('should stop with the git output when a push fails', async () => {
    git['push origin --delete 1.0.0'] = { status: 1, stdout: 'out', stderr: 'rejected' };
    expect(await main(['2.'])).toBe(1);
    expect(error).toHaveBeenCalledWith('git push origin --delete 1.0.0 failed:\nrejected\nout');
    git['push origin --delete 1.0.0'] = { status: 1 };
    expect(await main(['2.'])).toBe(1);
    expect(error).toHaveBeenCalledWith('git push origin --delete 1.0.0 failed.');
    expect(gitCommands()).not.toContain('gc --prune=now');
  });

  test('should report unexpected errors', async () => {
    spawnSync.mockImplementationOnce(() => {
      throw new Error('spawnSync git ENOENT');
    });
    expect(await main(['2.'])).toBe(1);
    expect(error).toHaveBeenCalledWith('spawnSync git ENOENT');
    spawnSync.mockImplementationOnce(() => {
      // oxlint-disable-next-line only-throw-error -- Report errors that are not Error instances too
      throw 'unknown';
    });
    expect(await main(['2.'])).toBe(1);
    expect(error).toHaveBeenCalledWith('unknown');
  });
});
