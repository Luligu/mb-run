import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import crossSpawn from 'cross-spawn';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BuildOptions } from '../src/build.js';
import { runBin, runWorkspaceBuild } from '../src/build.js';
import { initLogger } from '../src/logger.js';
import { ExitError } from '../src/spawn.js';

vi.mock('cross-spawn', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof import('cross-spawn') }>();
  return { default: vi.fn(actual.default) };
});

const mockCrossSpawn = vi.mocked(crossSpawn);

function makeChild(exitCode: number | null): ReturnType<typeof crossSpawn> {
  const child = new EventEmitter();
  setImmediate(() => child.emit('exit', exitCode));
  return child as ReturnType<typeof crossSpawn>;
}

function makeOpts(overrides?: Partial<BuildOptions>): BuildOptions {
  return {
    rootDir: process.cwd(),
    isWindows: false,
    dryRun: true,
    mode: 'build',
    watch: false,
    ...overrides,
  };
}

let lines: string[] = [];

beforeEach(() => {
  lines = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(String(args[0]));
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  initLogger({ dryRun: true, verbose: false, rootDir: process.cwd() });
  mockCrossSpawn.mockImplementation(() => makeChild(0));
});

describe('runBin — known entrypoint (tsc)', () => {
  it('calls logCommand with the tool label in dryRun mode', async () => {
    await runBin('tsc', ['--version'], makeOpts());
    // The logged line contains the tool label and the display args.
    expect(lines.some((l) => l.includes('tsc') && l.includes('--version'))).toBe(true);
  });

  it('does not spawn a process when dryRun=true', async () => {
    await runBin('tsc', [], makeOpts({ dryRun: true }));
    expect(mockCrossSpawn).not.toHaveBeenCalled();
  });

  it('throws ExitError when the entrypoint file does not exist', async () => {
    const opts = makeOpts({ rootDir: '/nonexistent-abc-xyz', dryRun: false });
    await expect(runBin('tsc', [], opts)).rejects.toBeInstanceOf(ExitError);
  });

  it('throws ExitError with "Missing binary" message when entrypoint is absent', async () => {
    const opts = makeOpts({ rootDir: '/nonexistent-abc-xyz', dryRun: false });
    await expect(runBin('tsc', [], opts)).rejects.toMatchObject({ message: expect.stringContaining('Missing binary') });
  });

  it('resolves when entrypoint exists and process exits 0', async () => {
    mockCrossSpawn.mockImplementationOnce(() => makeChild(0));
    const opts = makeOpts({ dryRun: false });
    await expect(runBin('tsc', ['--version'], opts)).resolves.toBeUndefined();
  });

  it('throws ExitError when entrypoint process exits non-zero', async () => {
    mockCrossSpawn.mockImplementationOnce(() => makeChild(2));
    const opts = makeOpts({ dryRun: false });
    await expect(runBin('tsc', ['--version'], opts)).rejects.toBeInstanceOf(ExitError);
  });

  it('ExitError carries the exit code from the process', async () => {
    mockCrossSpawn.mockImplementationOnce(() => makeChild(5));
    const opts = makeOpts({ dryRun: false });
    await expect(runBin('tsc', [], opts)).rejects.toMatchObject({ code: 5 });
  });

  it('propagates spawn error events as rejections', async () => {
    const child = new EventEmitter();
    mockCrossSpawn.mockImplementationOnce(() => {
      setImmediate(() => child.emit('error', new Error('spawn error')));
      return child as ReturnType<typeof crossSpawn>;
    });
    const opts = makeOpts({ dryRun: false });
    await expect(runBin('tsc', [], opts)).rejects.toThrow('spawn error');
  });

  it('treats null exit code as 1', async () => {
    mockCrossSpawn.mockImplementationOnce(() => makeChild(null));
    const opts = makeOpts({ dryRun: false });
    await expect(runBin('tsc', [], opts)).rejects.toMatchObject({ code: 1 });
  });

  it('passes runOptions.env to spawn', async () => {
    const opts = makeOpts({ dryRun: false });
    await runBin('tsc', [], opts, { env: { MY_VAR: 'hello' } });
    expect(mockCrossSpawn).toHaveBeenCalledWith(process.execPath, expect.any(Array), expect.objectContaining({ env: expect.objectContaining({ MY_VAR: 'hello' }) }));
  });
});

describe('runBin — unknown bin (shim path)', () => {
  it('calls logCommand with the bin label when isWindows=false', async () => {
    await runBin('shx', ['--version'], makeOpts({ isWindows: false }));
    expect(lines.some((l) => l.includes('shx') && l.includes('--version'))).toBe(true);
  });

  it('calls logCommand with the bin label when isWindows=true', async () => {
    await runBin('shx', [], makeOpts({ isWindows: true }));
    expect(lines.some((l) => l.includes('shx') && !l.includes('shx.cmd'))).toBe(true);
  });

  it('does not spawn a process when dryRun=true', async () => {
    await runBin('shx', [], makeOpts({ dryRun: true }));
    expect(mockCrossSpawn).not.toHaveBeenCalled();
  });

  it('throws ExitError when the shim file does not exist', async () => {
    const opts = makeOpts({ rootDir: '/nonexistent-abc-xyz', isWindows: false, dryRun: false });
    await expect(runBin('shx', [], opts)).rejects.toBeInstanceOf(ExitError);
  });

  it('uses the .cmd shim path when isWindows=true', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-shim-'));
    try {
      await mkdir(path.join(tmpDir, 'node_modules', '.bin'), { recursive: true });
      await writeFile(path.join(tmpDir, 'node_modules', '.bin', 'shx.cmd'), '');
      mockCrossSpawn.mockImplementationOnce(() => makeChild(0));
      const opts = makeOpts({ isWindows: true, dryRun: false, rootDir: tmpDir });
      await runBin('shx', [], opts);
      expect(mockCrossSpawn).toHaveBeenCalledWith(expect.stringContaining('shx.cmd'), [], expect.anything());
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('uses the plain shim path when isWindows=false', async () => {
    mockCrossSpawn.mockImplementationOnce(() => makeChild(0));
    const opts = makeOpts({ isWindows: false, dryRun: false });
    await runBin('shx', [], opts);
    expect(mockCrossSpawn).toHaveBeenCalledWith(expect.stringMatching(/node_modules[/\\]\.bin[/\\]shx$/), [], expect.anything());
  });

  it('throws ExitError when the shim process exits non-zero (Windows)', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-shim-'));
    try {
      await mkdir(path.join(tmpDir, 'node_modules', '.bin'), { recursive: true });
      await writeFile(path.join(tmpDir, 'node_modules', '.bin', 'shx.cmd'), '');
      mockCrossSpawn.mockImplementationOnce(() => makeChild(3));
      const opts = makeOpts({ isWindows: true, dryRun: false, rootDir: tmpDir });
      await expect(runBin('shx', [], opts)).rejects.toMatchObject({ code: 3 });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('treats null exit code as 1 (shim path)', async () => {
    mockCrossSpawn.mockImplementationOnce(() => makeChild(null));
    const opts = makeOpts({ isWindows: false, dryRun: false });
    await expect(runBin('shx', [], opts)).rejects.toMatchObject({ code: 1 });
  });
});

describe('runWorkspaceBuild', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-build-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('build mode picks tsconfig.build.json when present', async () => {
    await writeFile(path.join(tmpDir, 'tsconfig.build.json'), '{}');
    await writeFile(path.join(tmpDir, 'tsconfig.json'), '{}');

    await runWorkspaceBuild(makeOpts({ rootDir: tmpDir, mode: 'build', watch: false }));

    expect(lines.some((l) => l.includes(path.join(tmpDir, 'tsconfig.build.json')))).toBe(true);
  });

  it('build mode falls back to tsconfig.json when tsconfig.build.json is absent', async () => {
    await writeFile(path.join(tmpDir, 'tsconfig.json'), '{}');

    await runWorkspaceBuild(makeOpts({ rootDir: tmpDir, mode: 'build', watch: false }));

    expect(lines.some((l) => l.includes(path.join(tmpDir, 'tsconfig.json')))).toBe(true);
  });

  it('production mode picks tsconfig.build.production.json when present', async () => {
    await writeFile(path.join(tmpDir, 'tsconfig.build.production.json'), '{}');
    await writeFile(path.join(tmpDir, 'tsconfig.build.json'), '{}');
    await writeFile(path.join(tmpDir, 'tsconfig.json'), '{}');

    await runWorkspaceBuild(makeOpts({ rootDir: tmpDir, mode: 'production', watch: false }));

    expect(lines.some((l) => l.includes(path.join(tmpDir, 'tsconfig.build.production.json')))).toBe(true);
  });

  it('production mode falls back to tsconfig.build.json when production config is absent', async () => {
    await writeFile(path.join(tmpDir, 'tsconfig.build.json'), '{}');
    await writeFile(path.join(tmpDir, 'tsconfig.json'), '{}');

    await runWorkspaceBuild(makeOpts({ rootDir: tmpDir, mode: 'production', watch: false }));

    expect(lines.some((l) => l.includes(path.join(tmpDir, 'tsconfig.build.json')))).toBe(true);
  });

  it('falls back to tsconfig.json when no tsconfig variant exists', async () => {
    await runWorkspaceBuild(makeOpts({ rootDir: tmpDir, mode: 'build', watch: false }));

    expect(lines.some((l) => l.includes(path.join(tmpDir, 'tsconfig.json')))).toBe(true);
  });

  it('appends --watch to args when watch=true', async () => {
    await writeFile(path.join(tmpDir, 'tsconfig.build.json'), '{}');

    await runWorkspaceBuild(makeOpts({ rootDir: tmpDir, mode: 'build', watch: true }));

    expect(lines.some((l) => l.includes('--watch'))).toBe(true);
  });

  it('does not append --watch when watch=false', async () => {
    await writeFile(path.join(tmpDir, 'tsconfig.build.json'), '{}');

    await runWorkspaceBuild(makeOpts({ rootDir: tmpDir, mode: 'build', watch: false }));

    expect(lines.every((l) => !l.includes('--watch'))).toBe(true);
  });
});
