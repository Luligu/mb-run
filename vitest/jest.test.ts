// oxlint-disable unicorn/no-useless-undefined -- typed vitest mocks require the explicit undefined resolve/return value
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runJest } from '../src/jest.js';

vi.mock('../src/build.js', () => ({
  runBin: vi.fn().mockResolvedValue(undefined),
}));

const { runBin } = await import('../src/build.js');
const mockRunBin = vi.mocked(runBin);
const baseOpts = { rootDir: '/repo', isWindows: false, dryRun: false, verbose: false, watch: false, coverage: false };

describe('jest', () => {
  beforeEach(() => {
    mockRunBin.mockClear();
  });

  it('runs Jest with the ESM Node.js options', async () => {
    await runJest(baseOpts);
    expect(mockRunBin).toHaveBeenCalledWith('jest', [], { ...baseOpts, mode: 'build', watch: false }, { env: { NODE_OPTIONS: '--experimental-vm-modules --no-warnings' } });
  });

  it('forwards the Windows and dry-run options', async () => {
    await runJest({ ...baseOpts, isWindows: true, dryRun: true });
    expect(mockRunBin.mock.calls[0][2]).toMatchObject({ isWindows: true, dryRun: true });
  });

  it('enables verbose output, watch mode, and coverage when requested', async () => {
    await runJest({ ...baseOpts, verbose: true, watch: true, coverage: true });
    expect(mockRunBin.mock.calls[0][1]).toEqual(['--verbose', '--watch', '--coverage']);
  });
});
