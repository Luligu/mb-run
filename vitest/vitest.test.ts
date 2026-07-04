/**
 * @file vitest/vitest.test.ts
 * @description This file contains the tests for the Vitest test-runner utilities.
 * @author Luca Liguori
 */

// oxlint-disable unicorn/no-useless-undefined -- typed vitest mocks require the explicit undefined resolve/return value

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runVitest } from '../src/vitest.js';

vi.mock('../src/build.js', () => ({
  runBin: vi.fn().mockResolvedValue(undefined),
}));

const { runBin } = await import('../src/build.js');
const mockRunBin = vi.mocked(runBin);
const baseOpts = { rootDir: '/repo', isWindows: false, dryRun: false, verbose: false, watch: false, coverage: false };

describe('vitest', () => {
  beforeEach(() => {
    mockRunBin.mockClear();
  });

  it('runs Vitest once using the project configuration', async () => {
    await runVitest(baseOpts);
    expect(mockRunBin).toHaveBeenCalledWith('vitest', ['run'], { ...baseOpts, mode: 'build', watch: false });
  });

  it('forwards the Windows and dry-run options', async () => {
    await runVitest({ ...baseOpts, isWindows: true, dryRun: true });
    expect(mockRunBin.mock.calls[0][2]).toMatchObject({ isWindows: true, dryRun: true });
  });

  it('enables verbose output, watch mode, and coverage when requested', async () => {
    await runVitest({ ...baseOpts, verbose: true, watch: true, coverage: true });
    expect(mockRunBin.mock.calls[0][1]).toEqual(['watch', '--reporter', 'verbose', '--coverage']);
  });
});
