/**
 * @file scripts/buntest/create-release.test.ts
 * @description This file contains the tests for create-release.
 * @author Luca Liguori
 */

import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
// oxlint-disable-next-line import/no-namespace -- spyOn needs the namespace to intercept the named imports of create-release.mjs
import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';

import { main } from '../create-release.mjs';

const CHANGELOG = ['# Changelog', '', '## [1.2.3] - 2026-09-30', '', '- New feature', '', '## [1.2.2] - 2026-09-01', '', '- Old feature', ''].join('\r\n');

const log = spyOn(console, 'log').mockImplementation(() => {});
const error = spyOn(console, 'error').mockImplementation(() => {});

let answer = '';
const close = mock(() => {});
const createInterface = spyOn(readline, 'createInterface').mockImplementation(
  () => ({ question: async () => answer, close }) as unknown as ReturnType<typeof readline.createInterface>,
);

let ghExitCode: number | Error = 0;
let notes = '';
let notesFile = '';
// Every gh command is mocked, so the tests never create a real release.
const spawn = spyOn(childProcess, 'spawn').mockImplementation(((_command: string, args: string[]) => {
  notesFile = args[args.indexOf('--notes-file') + 1];
  notes = readFileSync(notesFile, 'utf8');
  const child = new EventEmitter();
  queueMicrotask(() => (ghExitCode instanceof Error ? child.emit('error', ghExitCode) : child.emit('close', ghExitCode)));
  return child;
}) as unknown as typeof childProcess.spawn);

let root: string;

/**
 * Write the package.json and the CHANGELOG.md of the temporary repository.
 *
 * @param {unknown} version The package.json version.
 * @param {string} [changelog] The CHANGELOG.md content.
 */
function writeRepo(version: unknown, changelog = CHANGELOG): void {
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
  writeFileSync(path.join(root, 'CHANGELOG.md'), changelog);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'create-release-test-'));
  writeRepo('1.2.3');
  answer = '';
  ghExitCode = 0;
  notes = '';
  notesFile = '';
  log.mockClear();
  error.mockClear();
  close.mockClear();
  spawn.mockClear();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  log.mockRestore();
  error.mockRestore();
  createInterface.mockRestore();
  spawn.mockRestore();
});

describe('create-release.mjs', () => {
  test('should print the version when called with --version or -v', async () => {
    for (const flag of ['--version', '-v']) {
      expect(await main([flag], root)).toBe(0);
    }
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+$/));
    expect(spawn).not.toHaveBeenCalled();
  });

  test('should print the help when called with --help or -h', async () => {
    for (const flag of ['--help', '-h']) {
      expect(await main([flag], root)).toBe(0);
    }
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    expect(spawn).not.toHaveBeenCalled();
  });

  test('should print the release without asking or creating it with --dry-run or -n', async () => {
    for (const flag of ['--dry-run', '-n']) {
      expect(await main([flag], root)).toBe(0);
    }
    expect(log).toHaveBeenCalledWith('Tag: 1.2.3');
    expect(log).toHaveBeenCalledWith('[dry-run] Release not created.');
    expect(createInterface).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  test('should create the release on main with the changelog section as notes', async () => {
    expect(await main([], root)).toBe(0);
    expect(log).toHaveBeenCalledWith('Tag: 1.2.3');
    expect(log).toHaveBeenCalledWith('Title: Release 1.2.3');
    expect(spawn).toHaveBeenCalledWith('gh', ['release', 'create', '1.2.3', '--title', 'Release 1.2.3', '--notes-file', notesFile, '--target', 'main'], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
    });
    expect(notes).toBe('## [1.2.3] - 2026-09-30\n\n- New feature\n');
    expect(existsSync(notesFile)).toBe(false);
    expect(close).toHaveBeenCalled();
  });

  test('should accept y and yes, strip a leading v and read the last changelog section', async () => {
    writeRepo('v1.2.2');
    for (const reply of ['y', ' YES ']) {
      answer = reply;
      expect(await main([], root)).toBe(0);
    }
    expect(notes).toBe('## [1.2.2] - 2026-09-01\n\n- Old feature\n');

    writeRepo('1.2.3', '## [v1.2.3]\n');
    expect(await main([], root)).toBe(0);
    expect(notes).toBe('## [v1.2.3]\n');
  });

  test('should abort without creating the release when the user does not confirm', async () => {
    answer = 'no';
    expect(await main([], root)).toBe(1);
    expect(error).toHaveBeenCalledWith('create-release: Aborted by user.');
    expect(close).toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  test('should fail when the package.json version or the changelog entry is missing', async () => {
    writeRepo(null);
    expect(await main([], root)).toBe(1);
    expect(error).toHaveBeenCalledWith('create-release: package.json does not contain a valid "version" string');
    writeRepo(123);
    expect(await main([], root)).toBe(1);
    writeRepo('9.9.9');
    expect(await main([], root)).toBe(1);
    expect(error).toHaveBeenCalledWith('create-release: Could not find changelog entry for [9.9.9] in CHANGELOG.md');
    expect(error).toHaveBeenCalledWith('Make sure you are authenticated with GitHub CLI: gh auth status');
    expect(spawn).not.toHaveBeenCalled();
  });

  test('should fail and clean up the notes when gh fails', async () => {
    ghExitCode = 1;
    expect(await main([], root)).toBe(1);
    expect(error).toHaveBeenCalledWith('create-release: gh exited with code 1');
    expect(existsSync(notesFile)).toBe(false);
    ghExitCode = new Error('spawn gh ENOENT');
    expect(await main([], root)).toBe(1);
    expect(error).toHaveBeenCalledWith('create-release: spawn gh ENOENT');
  });

  test('should fail and clean up the temporary directory when the notes cannot be written', async () => {
    const writeFile = spyOn(fs, 'writeFile').mockImplementationOnce(() => {
      // oxlint-disable-next-line only-throw-error -- Report errors that are not Error instances too
      throw 'disk full';
    });
    const rm = spyOn(fs, 'rm');
    expect(await main([], root)).toBe(1);
    expect(error).toHaveBeenCalledWith('create-release: disk full');
    expect(existsSync(String(rm.mock.calls[0][0]))).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    writeFile.mockRestore();
    rm.mockRestore();
  });
});
