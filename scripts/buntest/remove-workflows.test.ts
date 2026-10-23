/**
 * @file scripts/buntest/remove-workflows.test.ts
 * @description This file contains the tests for remove-workflows.
 * @author Luca Liguori
 */

/* oxlint-disable import/no-namespace -- spyOn needs the namespaces to intercept the named imports of remove-workflows.mjs */

import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fsPromises from 'node:fs/promises';

import { main } from '../remove-workflows.mjs';

type CommandResult = { code: number; stdout?: string; stderr?: string } | Error;
type Run = {
  id: number;
  status?: string;
  conclusion?: string;
  created_at?: string;
  name?: string;
  display_title?: string;
  run_number?: number;
  head_branch?: string;
  html_url?: string;
};

const OLD = '2000-01-01T00:00:00Z';
const RECENT = '2999-01-01T00:00:00Z';

const log = spyOn(console, 'log').mockImplementation(() => {});
const error = spyOn(console, 'error').mockImplementation(() => {});

// The package.json read as the repository fallback, undefined when it cannot be read.
let packageJson: string | undefined;
const readFile = spyOn(fsPromises, 'readFile').mockImplementation((async () => {
  if (packageJson === undefined) throw new Error('ENOENT');
  return packageJson;
}) as unknown as typeof fsPromises.readFile);

// The command output keyed by the command and its arguments. Missing commands succeed with no output.
let commands: Record<string, CommandResult> = {};
// Every git and gh command is mocked, so the tests never delete a real workflow run.
const fakeSpawn = ((command: string, args: string[]) => {
  const result = commands[`${command} ${args.join(' ')}`] ?? { code: 0 };
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  queueMicrotask(() => {
    if (result instanceof Error) {
      child.emit('error', result);
      return;
    }
    if (result.stdout) child.stdout.emit('data', result.stdout);
    if (result.stderr) child.stderr.emit('data', result.stderr);
    child.emit('close', result.code);
  });
  return child;
}) as unknown as typeof childProcess.spawn;
const spawn = spyOn(childProcess, 'spawn').mockImplementation(fakeSpawn);

/**
 * Build the gh command that lists a page of workflow runs.
 *
 * @param {number} page The page number.
 * @param {string} [repository] The repository in owner/repo form.
 * @returns {string} The command key.
 */
function listPage(page: number, repository = 'owner/repo'): string {
  return `gh api --method GET repos/${repository}/actions/runs?per_page=100&page=${page}`;
}

/**
 * Set the workflow runs returned by the first page.
 *
 * @param {Run[]} runs The workflow runs.
 */
function setRuns(runs: Run[]): void {
  commands[listPage(1)] = { code: 0, stdout: JSON.stringify({ workflow_runs: runs }) };
}

/**
 * Get the workflow run deletions run so far.
 *
 * @returns {number[]} The deleted run ids.
 */
function deletedIds(): number[] {
  return spawn.mock.calls.filter((call) => (call[1] as string[])[2] === 'DELETE').map((call) => Number((call[1] as string[])[3].split('/').at(-1)));
}

beforeEach(() => {
  commands = { 'git remote get-url origin': { code: 0, stdout: 'git@github.com:owner/repo.git\n' } };
  setRuns([
    { id: 1, status: 'completed', conclusion: 'success', created_at: OLD, name: 'CI', run_number: 7, head_branch: 'main', html_url: 'https://github.com/run/1' },
    { id: 2, status: 'completed', conclusion: 'cancelled', created_at: RECENT, display_title: 'Docs' },
    { id: 3, status: 'completed', conclusion: 'cancelled', created_at: OLD },
    { id: 4, status: 'in_progress', created_at: OLD, html_url: 'https://github.com/run/4' },
    { id: 5, status: 'queued', created_at: OLD },
    { id: 6, status: 'completed', conclusion: 'success', created_at: RECENT },
    { id: 7, created_at: 'not a date' },
  ]);
  packageJson = undefined;
  log.mockClear();
  error.mockClear();
  spawn.mockClear();
});

afterAll(() => {
  log.mockRestore();
  error.mockRestore();
  readFile.mockRestore();
  spawn.mockRestore();
});

describe('remove-workflows.mjs', () => {
  test('should print the version with --version or -v and the help with --help or -h', async () => {
    for (const flag of ['--version', '-v', '--help', '-h']) {
      expect(await main([flag])).toBe(0);
    }
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+$/));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    expect(spawn).not.toHaveBeenCalled();
  });

  test('should reject unknown arguments', async () => {
    expect(await main(['--wrong'])).toBe(1);
    expect(error).toHaveBeenCalledWith('remove-workflows: Unknown argument: --wrong');
    expect(error).toHaveBeenCalledWith('Make sure GitHub CLI is installed and authenticated: gh auth status');
    expect(spawn).not.toHaveBeenCalled();
  });

  test('should list the old and the cancelled runs and skip the active ones with --dry-run', async () => {
    expect(await main(['--dry-run'])).toBe(0);
    expect(log).toHaveBeenCalledWith('Mode: dry-run');
    expect(log).toHaveBeenCalledWith(
      '[dry-run] Would delete (older-than-one-week) CI #7 branch=main created=2000-01-01T00:00:00Z status=completed conclusion=success html_url=https://github.com/run/1',
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[dry-run] Would delete (cancelled) Docs id=2'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[dry-run] Would delete (older-than-one-week,cancelled) workflow id=3'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[skip] workflow id=4 created=2000-01-01T00:00:00Z status=in_progress html_url=https://github.com/run/4'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[skip] workflow id=5 created=2000-01-01T00:00:00Z status=queued html_url=n/a'));
    expect(log).toHaveBeenCalledWith('Scanned: 7');
    expect(log).toHaveBeenCalledWith('Skipped active: 2');
    expect(log).toHaveBeenCalledWith('Would delete: 3');
    expect(deletedIds()).toEqual([]);
  });

  test('should delete the old and the cancelled runs and report each failure', async () => {
    expect(await main([])).toBe(0);
    expect(deletedIds()).toEqual([1, 2, 3]);
    expect(log).toHaveBeenCalledWith('Deleted: 3');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[delete] Deleted (older-than-one-week) CI #7'));

    spawn.mockClear();
    commands['gh api --method DELETE repos/owner/repo/actions/runs/1'] = { code: 1, stderr: 'HTTP 403' };
    commands['gh api --method DELETE repos/owner/repo/actions/runs/2'] = { code: 1, stdout: 'HTTP 404' };
    commands['gh api --method DELETE repos/owner/repo/actions/runs/3'] = { code: 1 };
    expect(await main([])).toBe(1);
    expect(deletedIds()).toEqual([1, 2, 3]);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^\[error\] Failed to delete CI #7 .*: HTTP 403$/));
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^\[error\] Failed to delete Docs id=2 .*: HTTP 404$/));
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^\[error\] Failed to delete workflow id=3 .*: gh exited with code 1$/));
    expect(log).toHaveBeenCalledWith('Failed: 3');
  });

  test('should list every page before deleting and stop on an empty or malformed page', async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, status: 'completed', created_at: OLD }));
    commands[listPage(1)] = { code: 0, stdout: JSON.stringify({ workflow_runs: page }) };
    commands[listPage(2)] = { code: 0, stdout: JSON.stringify({ workflow_runs: page }) };
    commands[listPage(3)] = { code: 0, stdout: '{}' };
    expect(await main([])).toBe(0);
    const calls = spawn.mock.calls.map((call) => (call[1] as string[])[2]);
    expect(calls.lastIndexOf('GET')).toBeLessThan(calls.indexOf('DELETE'));
    expect(log).toHaveBeenCalledWith('Scanned: 200');
  });

  test('should read the repository from the https git remote or from package.json', async () => {
    commands['git remote get-url origin'] = { code: 0, stdout: 'https://github.com/owner/repo/tree/main' };
    expect(await main(['--dry-run'])).toBe(0);
    expect(log).toHaveBeenCalledWith('Repository: owner/repo');

    commands['git remote get-url origin'] = { code: 2, stderr: 'No such remote' };
    commands[listPage(1, 'pkg/string')] = { code: 0, stdout: '{}' };
    commands[listPage(1, 'pkg/object')] = { code: 0, stdout: '{}' };
    packageJson = JSON.stringify({ repository: 'git+https://github.com/pkg/string.git' });
    expect(await main([])).toBe(0);
    expect(log).toHaveBeenCalledWith('Repository: pkg/string');
    packageJson = JSON.stringify({ repository: { url: 'https://github.com/pkg/object' } });
    expect(await main([])).toBe(0);
    expect(log).toHaveBeenCalledWith('Repository: pkg/object');
  });

  test('should fail when the repository cannot be determined', async () => {
    commands['git remote get-url origin'] = { code: 0, stdout: 'not a url' };
    for (const repository of [undefined, '', 'https://gitlab.com/owner/repo', 'https://github.com/owner']) {
      packageJson = JSON.stringify({ repository });
      expect(await main([])).toBe(1);
    }
    commands['git remote get-url origin'] = new Error('spawn git ENOENT');
    packageJson = undefined;
    expect(await main([])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('remove-workflows: Could not determine the GitHub repository.'));
    expect(deletedIds()).toEqual([]);
  });

  test('should fail without deleting when the runs cannot be listed', async () => {
    commands[listPage(1)] = { code: 1, stderr: 'HTTP 401: Bad credentials' };
    expect(await main([])).toBe(1);
    expect(error).toHaveBeenCalledWith('remove-workflows: HTTP 401: Bad credentials');
    expect(deletedIds()).toEqual([]);
  });

  test('should report errors that are not Error instances', async () => {
    spawn.mockImplementationOnce(fakeSpawn).mockImplementationOnce(() => {
      // oxlint-disable-next-line only-throw-error -- Report errors that are not Error instances too
      throw 'unknown';
    });
    expect(await main([])).toBe(1);
    expect(error).toHaveBeenCalledWith('remove-workflows: unknown');
  });
});
