/**
 * @file vitest/dts.test.ts
 * @description This file contains the tests for the declaration build utilities.
 * @author Luca Liguori
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runDtsBuild } from '../src/dts.js';

vi.mock('../src/build.js', () => ({
  runBin: vi.fn().mockImplementation(async () => {}),
}));

vi.mock('../src/helpers.js', () => ({
  isMonorepo: vi.fn().mockResolvedValue(false),
}));

const { runBin } = await import('../src/build.js');
const { isMonorepo } = await import('../src/helpers.js');

const mockRunBin = vi.mocked(runBin);
const mockIsMonorepo = vi.mocked(isMonorepo);

let tmpDir: string;

describe('dts', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-dts-'));
    mockRunBin.mockClear();
    mockIsMonorepo.mockClear();
    mockRunBin.mockImplementation(async () => {});
    mockIsMonorepo.mockResolvedValue(false);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should run declaration emit with --project when package is not a monorepo', async () => {
    await runDtsBuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    expect(mockRunBin).toHaveBeenCalledWith(
      'tsc',
      [
        '--project',
        path.join(tmpDir, 'tsconfig.build.json'),
        '--incremental',
        'false',
        '--composite',
        'false',
        '--declaration',
        '--declarationMap',
        'false',
        '--emitDeclarationOnly',
      ],
      { rootDir: tmpDir, isWindows: false, dryRun: false, mode: 'build', watch: false },
    );
  });

  it('should run declaration emit with --build when package is a monorepo', async () => {
    mockIsMonorepo.mockResolvedValue(true);

    await runDtsBuild({ rootDir: tmpDir, isWindows: true, dryRun: false });

    expect(mockRunBin).toHaveBeenCalledWith(
      'tsc',
      ['--build', path.join(tmpDir, 'tsconfig.build.json'), '--incremental', 'true', '--composite', 'true', '--declaration', '--declarationMap', 'false', '--emitDeclarationOnly'],
      { rootDir: tmpDir, isWindows: true, dryRun: false, mode: 'build', watch: false },
    );
  });

  it('should pass dry-run through to the TypeScript command runner when enabled', async () => {
    await runDtsBuild({ rootDir: tmpDir, isWindows: false, dryRun: true });

    expect(mockRunBin).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ dryRun: true }));
  });
});
