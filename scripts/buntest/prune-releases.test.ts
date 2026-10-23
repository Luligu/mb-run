/**
 * @file scripts/buntest/prune-releases.test.ts
 * @description This file contains the tests for prune-releases.
 * @author Luca Liguori
 */

/* oxlint-disable import/no-namespace -- spyOn needs the namespaces to intercept the named imports of prune-releases.mjs */

import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as readline from 'node:readline';

import { main } from '../prune-releases.mjs';

type CommandResult = { status: number; stdout?: string; stderr?: string };

const log = spyOn(console, 'log').mockImplementation(() => {});
const error = spyOn(console, 'error').mockImplementation(() => {});

let answer = 'y';
const close = mock(() => {});
const createInterface = spyOn(readline, 'createInterface').mockImplementation(
  () => ({ question: (_query: string, callback: (value: string) => void) => callback(answer), close }) as unknown as readline.Interface,
);

// The package.json read as the repository fallback, undefined when it cannot be read.
let packageJson: string | undefined;
const readFileSync = spyOn(fs, 'readFileSync').mockImplementation((() => {
  if (packageJson === undefined) throw new Error('ENOENT');
  return packageJson;
}) as unknown as typeof fs.readFileSync);

// The command output keyed by the command and its arguments. Missing commands succeed with no output.
let commands: Record<string, CommandResult> = {};
// Every git and gh command is mocked, so the tests never delete a real release.
const spawnSync = spyOn(childProcess, 'spawnSync').mockImplementation(((command: string, args: string[]) => {
  return commands[`${command} ${args.join(' ')}`] ?? { status: 0, stdout: '', stderr: '' };
}) as unknown as typeof childProcess.spawnSync);

/**
 * Build the gh command that lists a page of releases.
 *
 * @param {number} page The page number.
 * @param {string} [repository] The repository in owner/repo form.
 * @returns {string} The command key.
 */
function listPage(page: number, repository = 'owner/repo'): string {
  return `gh api --method GET repos/${repository}/releases?per_page=100&page=${page}`;
}

/**
 * Get the release deletions run so far.
 *
 * @returns {string[]} The deleted tags.
 */
function deletedTags(): string[] {
  return spawnSync.mock.calls.filter((call) => (call[1] as string[])[1] === 'delete').map((call) => (call[1] as string[])[2]);
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
  commands = {
    'git remote get-url origin': { status: 0, stdout: 'git@github.com:owner/repo.git\n' },
    [listPage(1)]: {
      status: 0,
      stdout: JSON.stringify([
        { tag_name: '2.0.0', name: 'Release 2.0.0' },
        { tag_name: '1.0.0', name: null, draft: true, prerelease: true },
        { tag_name: '1.1.0', name: 'Release 1.1.0' },
        { tag_name: ' ', name: 'No tag' },
        { name: 'Missing tag' },
      ]),
    },
  };
  packageJson = undefined;
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
  readFileSync.mockRestore();
  spawnSync.mockRestore();
});

describe('prune-releases.mjs', () => {
  test('should print the version with --version or -v and the usage with --help or -h', async () => {
    for (const flag of ['--version', '-v', '--help', '-h']) {
      expect(await main([flag])).toBe(0);
    }
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+$/));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage: node scripts/prune-releases.mjs'));
    expect(spawnSync).not.toHaveBeenCalled();
  });

  test('should reject unknown options and a missing prefix', async () => {
    expect(await main(['--force', '2.'])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown option(s): --force'));
    expect(await main(['--dry-run'])).toBe(1);
    expect(error).toHaveBeenLastCalledWith(expect.stringContaining('Usage: node scripts/prune-releases.mjs'));
    expect(spawnSync).not.toHaveBeenCalled();
  });

  test('should read the repository from the https git remote or from package.json', async () => {
    commands['git remote get-url origin'] = { status: 0, stdout: 'https://github.com/owner/repo.git' };
    expect(await main(['--dry-run', '2.'])).toBe(0);
    expect(output()).toMatch(/Repository:\s+owner\/repo/);

    commands['git remote get-url origin'] = { status: 2 };
    commands[listPage(1, 'pkg/string')] = { status: 0, stdout: '[]' };
    commands[listPage(1, 'pkg/object')] = { status: 0, stdout: '[]' };
    packageJson = JSON.stringify({ repository: 'git+https://github.com/pkg/string.git' });
    expect(await main(['2.'])).toBe(0);
    packageJson = JSON.stringify({ repository: { url: 'https://github.com/pkg/object/tree/main' } });
    expect(await main(['2.'])).toBe(0);
    expect(output()).toContain('No releases found.');
  });

  test('should fail when the repository cannot be determined', async () => {
    commands['git remote get-url origin'] = { status: 0, stdout: 'not a url' };
    for (const repository of [undefined, '', 'https://gitlab.com/owner/repo', 'https://github.com/owner']) {
      packageJson = JSON.stringify({ repository });
      expect(await main(['2.'])).toBe(1);
    }
    packageJson = undefined;
    expect(await main(['2.'])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Could not determine the GitHub repository.'));
    expect(error).toHaveBeenCalledWith('Make sure GitHub CLI is installed and authenticated: gh auth status');
  });

  test('should list every page before deciding, and stop when every tag matches the prefix', async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({ tag_name: `2.0.${index}` }));
    commands[listPage(1)] = { status: 0, stdout: JSON.stringify(page) };
    commands[listPage(2)] = { status: 0, stdout: JSON.stringify(page) };
    commands[listPage(3)] = { status: 0, stdout: '{}' };
    expect(await main(['2.'])).toBe(0);
    expect(output()).toMatch(/Releases:\s+200/);
    expect(output()).toContain("No releases to delete. All release tags already match prefix '2.'.");
    expect(deletedTags()).toEqual([]);

    commands[listPage(1)] = { status: 0, stdout: JSON.stringify([{ name: 'Missing tag' }]) };
    expect(await main(['2.'])).toBe(0);
    expect(output()).toMatch(/With tags:\s+0/);
    expect(output()).toContain('(none)');
  });

  test('should print the planned commands without changes with --dry-run or -n', async () => {
    for (const flag of ['--dry-run', '-n']) {
      expect(await main([flag, '2.'])).toBe(0);
    }
    expect(output()).toContain('gh release delete 1.0.0 --repo owner/repo --yes');
    expect(output()).toContain('gh release delete 1.1.0 --repo owner/repo --yes');
    expect(deletedTags()).toEqual([]);
  });

  test('should abort without changes when the user does not confirm', async () => {
    answer = '';
    expect(await main(['2.'])).toBe(1);
    expect(output()).toContain('Aborted.');
    expect(close).toHaveBeenCalled();
    expect(deletedTags()).toEqual([]);
  });

  test('should delete the releases outside the prefix and report each failure', async () => {
    expect(await main(['2.'])).toBe(0);
    expect(deletedTags()).toEqual(['1.0.0', '1.1.0']);
    expect(output()).toMatch(/Deleted 1\.0\.0\s+release draft prerelease/);
    expect(output()).toMatch(/Failed:\s+0/);

    spawnSync.mockClear();
    commands['gh release delete 1.0.0 --repo owner/repo --yes'] = { status: 1, stderr: 'not found' };
    commands['gh release delete 1.1.0 --repo owner/repo --yes'] = { status: 1 };
    expect(await main(['2.'])).toBe(1);
    expect(deletedTags()).toEqual(['1.0.0', '1.1.0']);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^Failed 1\.0\.0\s+release draft prerelease: gh release delete 1\.0\.0 .* failed:\nnot found$/));
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^Failed 1\.1\.0\s+Release 1\.1\.0: gh release delete 1\.1\.0 --repo owner\/repo --yes failed\.$/));
    expect(output()).toMatch(/Deleted:\s+0/);
  });

  test('should fail with the gh output when listing the releases fails', async () => {
    commands[listPage(1)] = { status: 1, stdout: 'out', stderr: 'HTTP 404' };
    expect(await main(['2.'])).toBe(1);
    expect(error).toHaveBeenCalledWith(`${listPage(1)} failed:\nHTTP 404\nout`);
    expect(deletedTags()).toEqual([]);
  });

  test('should report errors that are not Error instances', async () => {
    spawnSync.mockImplementationOnce(() => {
      // oxlint-disable-next-line only-throw-error -- Report errors that are not Error instances too
      throw 'unknown';
    });
    expect(await main(['2.'])).toBe(1);
    expect(error).toHaveBeenCalledWith('unknown');
  });
});
