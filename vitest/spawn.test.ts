import { EventEmitter } from 'node:events';

import crossSpawn from 'cross-spawn';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initLogger } from '../src/logger.js';
import { ExitError, runCommand } from '../src/spawn.js';

vi.mock('cross-spawn', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof import('cross-spawn') }>();
  return { default: vi.fn(actual.default) };
});

const mockCrossSpawn = vi.mocked(crossSpawn);

let lines: string[] = [];

beforeEach(() => {
  lines = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(String(args[0]));
  });
  initLogger({ dryRun: false, verbose: true, rootDir: '/' });
});

describe('ExitError', () => {
  it('is an instance of Error', () => {
    const err = new ExitError(2, 'failed');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ExitError);
  });

  it('stores the exit code and message', () => {
    const err = new ExitError(42, 'something went wrong');
    expect(err.code).toBe(42);
    expect(err.message).toBe('something went wrong');
  });
});

describe('runCommand', () => {
  it('logs the command, args, and cwd when verbose', async () => {
    await runCommand('node', ['--version'], { dryRun: true, cwd: '/some/dir' });
    expect(lines.some((l) => l.includes('node') && l.includes('--version') && l.includes('/some/dir'))).toBe(true);
  });

  it('logs the command without explicit cwd when not provided', async () => {
    await runCommand('node', ['--version'], { dryRun: true });
    expect(lines.some((l) => l.includes('node') && l.includes('--version'))).toBe(true);
  });

  it('does not log when shouldLogActions is false', async () => {
    initLogger({ dryRun: false, verbose: false, rootDir: '/' });
    await runCommand('node', ['--version'], { dryRun: true });
    expect(lines).toHaveLength(0);
  });

  it('resolves immediately when dryRun=true without spawning', async () => {
    await expect(runCommand('nonexistent-xyz-abc', [], { dryRun: true })).resolves.toBeUndefined();
  });

  it('runs a real command and resolves when the exit code is 0', async () => {
    await expect(runCommand('node', ['--version'])).resolves.toBeUndefined();
  });

  it('passes env overrides to the child process', async () => {
    await expect(runCommand('node', ['--version'], { env: { CUSTOM_VAR: 'test' } })).resolves.toBeUndefined();
  });

  it('passes cwd to the child process', async () => {
    await expect(runCommand('node', ['--version'], { cwd: process.cwd() })).resolves.toBeUndefined();
  });

  it('throws ExitError when the command exits with a non-zero code', async () => {
    await expect(runCommand('node', ['-e', 'process.exit(3)'])).rejects.toBeInstanceOf(ExitError);
  });

  it('ExitError carries the exit code from the child process', async () => {
    await expect(runCommand('node', ['-e', 'process.exit(7)'])).rejects.toMatchObject({ code: 7 });
  });

  it('treats null exit code as 1', async () => {
    const child = new EventEmitter();
    mockCrossSpawn.mockImplementationOnce(() => {
      setImmediate(() => child.emit('exit', null));
      return child as ReturnType<typeof crossSpawn>;
    });
    await expect(runCommand('nonexistent', [])).rejects.toMatchObject({ code: 1 });
  });
});
