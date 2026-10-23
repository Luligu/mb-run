/**
 * @file scripts/buntest/git-sync-dev.test.ts
 * @description This file contains the tests for git-sync-dev.
 * @author Luca Liguori
 */

import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
// oxlint-disable-next-line import/no-namespace -- spyOn needs the namespace to intercept the named imports of git-sync-dev.mjs
import * as childProcess from 'node:child_process';

import { main } from '../git-sync-dev.mjs';

const log = spyOn(console, 'log').mockImplementation(() => {});
const error = spyOn(console, 'error').mockImplementation(() => {});
// Every git command is mocked, so the tests never touch the real repository.
const execFileSync = spyOn(childProcess, 'execFileSync').mockReturnValue('');

/**
 * Get the git commands run so far.
 *
 * @returns {string[]} The git arguments of every call, joined by spaces.
 */
function gitCommands(): string[] {
  return execFileSync.mock.calls.map(([command, args]) => `${command} ${(args as string[]).join(' ')}`);
}

beforeEach(() => {
  log.mockClear();
  error.mockClear();
  execFileSync.mockClear();
});

afterAll(() => {
  log.mockRestore();
  error.mockRestore();
  execFileSync.mockRestore();
});

describe('git-sync-dev.mjs', () => {
  test('should print the version when called with --version or -v', () => {
    for (const flag of ['--version', '-v']) {
      expect(main([flag])).toBe(0);
    }
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+$/));
    expect(execFileSync).not.toHaveBeenCalled();
  });

  test('should print the usage when called with --help or -h', () => {
    for (const flag of ['--help', '-h']) {
      expect(main([flag])).toBe(0);
    }
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage: node scripts/git-sync-dev.mjs'));
    expect(execFileSync).not.toHaveBeenCalled();
  });

  test('should reject a missing or invalid operation and unknown options without running git', () => {
    for (const args of [[], ['pull'], ['--dry-run'], ['merge', 'rebase'], ['--foo', 'merge']]) {
      error.mockClear();
      expect(main(args)).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Usage: node scripts/git-sync-dev.mjs'));
    }
    expect(execFileSync).not.toHaveBeenCalled();
  });

  test('should only print the git commands with --dry-run or -n', () => {
    for (const [flag, operation] of [
      ['--dry-run', 'merge'],
      ['-n', 'rebase'],
    ]) {
      log.mockClear();
      expect(main([flag, operation])).toBe(0);
      const lines = log.mock.calls.map((call) => String(call[0]));
      expect(lines[0]).toBe('[dry-run] git fetch origin');
      expect(lines[1]).toBe('[dry-run] git switch dev');
      expect(lines[2]).toBe('[dry-run] git merge-base --is-ancestor refs/remotes/origin/dev dev');
      expect(lines[3]).toMatch(/^\[dry-run\] git branch dev-backup-\d{8}-\d{6}$/);
      expect(lines[4]).toMatch(/^\[dry-run\] Would create backup branch: dev-backup-\d{8}-\d{6}$/);
      expect(lines).toHaveLength(7);
    }
    expect(execFileSync).not.toHaveBeenCalled();
  });

  test('should back up dev, then merge origin/main and push', () => {
    expect(main(['merge'])).toBe(0);
    const commands = gitCommands();
    expect(commands[0]).toBe('git fetch origin');
    expect(commands[1]).toBe('git switch dev');
    expect(commands[2]).toBe('git rev-parse --verify --quiet refs/remotes/origin/dev');
    expect(commands[3]).toBe('git merge-base --is-ancestor refs/remotes/origin/dev dev');
    expect(commands[4]).toMatch(/^git branch dev-backup-\d{8}-\d{6}$/);
    expect(commands.slice(5)).toEqual(['git merge origin/main', 'git push origin dev']);
    expect(execFileSync).toHaveBeenCalledWith('git', ['fetch', 'origin'], { stdio: 'inherit', shell: false });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Created backup branch: dev-backup-\d{8}-\d{6}$/));
  });

  test('should back up dev, then rebase on origin/main and force push with lease if it includes origin/dev', () => {
    expect(main(['rebase'])).toBe(0);
    expect(gitCommands().slice(5)).toEqual(['git rebase origin/main', 'git push --force-with-lease --force-if-includes origin dev']);
  });

  test('should stop before the backup when origin/dev has commits that dev lacks', () => {
    for (const operation of ['merge', 'rebase']) {
      execFileSync.mockClear();
      error.mockClear();
      execFileSync
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockImplementationOnce(() => {
          throw new Error('not an ancestor');
        });
      expect(main([operation])).toBe(1);
      expect(gitCommands()).toEqual([
        'git fetch origin',
        'git switch dev',
        'git rev-parse --verify --quiet refs/remotes/origin/dev',
        'git merge-base --is-ancestor refs/remotes/origin/dev dev',
      ]);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('origin/dev has commits that the local dev lacks'));
    }
  });

  test('should skip the ancestor check when origin/dev does not exist', () => {
    execFileSync
      .mockReturnValueOnce('')
      .mockReturnValueOnce('')
      .mockImplementationOnce(() => {
        throw new Error('no origin/dev');
      });
    expect(main(['rebase'])).toBe(0);
    const commands = gitCommands();
    expect(commands).not.toContain('git merge-base --is-ancestor refs/remotes/origin/dev dev');
    expect(commands.slice(3)).toEqual([expect.stringMatching(/^git branch dev-backup-/), 'git rebase origin/main', 'git push --force-with-lease --force-if-includes origin dev']);
  });

  test('should stop at the first failing git command', () => {
    execFileSync.mockReturnValueOnce('').mockImplementationOnce(() => {
      throw new Error('switch failed');
    });
    expect(() => main(['merge'])).toThrow('switch failed');
    expect(gitCommands()).toEqual(['git fetch origin', 'git switch dev']);
  });
});
