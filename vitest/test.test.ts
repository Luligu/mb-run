// oxlint-disable unicorn/no-useless-undefined -- typed vitest mocks require the explicit undefined resolve/return value
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExitError } from '../src/spawn.js';
import { runTests } from '../src/test.js';

vi.mock('../src/build.js', () => ({
  binExists: vi.fn(),
}));

vi.mock('../src/clean.js', () => ({
  fileExists: vi.fn(),
}));

vi.mock('../src/jest.js', () => ({
  runJest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/vitest.js', () => ({
  runVitest: vi.fn().mockResolvedValue(undefined),
}));

const { binExists } = await import('../src/build.js');
const { fileExists } = await import('../src/clean.js');
const { runJest } = await import('../src/jest.js');
const { runVitest } = await import('../src/vitest.js');
const mockBinExists = vi.mocked(binExists);
const mockFileExists = vi.mocked(fileExists);
const mockRunJest = vi.mocked(runJest);
const mockRunVitest = vi.mocked(runVitest);
const baseOpts = { rootDir: '/repo', isWindows: false, dryRun: false, verbose: false, watch: false, coverage: false };

describe('test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBinExists.mockResolvedValue(false);
    mockFileExists.mockResolvedValue(false);
    mockRunJest.mockResolvedValue(undefined);
    mockRunVitest.mockResolvedValue(undefined);
  });

  it('runs Jest when its configuration and binary are present', async () => {
    mockFileExists.mockImplementation(async (filePath) => filePath.endsWith('jest.config.js'));
    mockBinExists.mockImplementation(async (name) => name === 'jest');
    await runTests(baseOpts);
    expect(mockRunJest).toHaveBeenCalledWith(baseOpts);
    expect(mockRunVitest).not.toHaveBeenCalled();
  });

  it('runs Vitest when its configuration and binary are present', async () => {
    mockFileExists.mockImplementation(async (filePath) => filePath.endsWith('vite.config.ts'));
    mockBinExists.mockImplementation(async (name) => name === 'vitest');
    await runTests(baseOpts);
    expect(mockRunVitest).toHaveBeenCalledWith(baseOpts);
    expect(mockRunJest).not.toHaveBeenCalled();
  });

  it('runs Jest before Vitest when both are eligible', async () => {
    mockFileExists.mockResolvedValue(true);
    mockBinExists.mockResolvedValue(true);
    const calls: string[] = [];
    mockRunJest.mockImplementation(async () => {
      calls.push('jest');
    });
    mockRunVitest.mockImplementation(async () => {
      calls.push('vitest');
    });
    await runTests(baseOpts);
    expect(calls).toEqual(['jest', 'vitest']);
  });

  it('excludes a runner when its configuration or binary is missing', async () => {
    mockFileExists.mockImplementation(async (filePath) => filePath.endsWith('jest.config.js'));
    mockBinExists.mockImplementation(async (name) => name === 'vitest');
    await expect(runTests(baseOpts)).rejects.toBeInstanceOf(ExitError);
    expect(mockRunJest).not.toHaveBeenCalled();
    expect(mockRunVitest).not.toHaveBeenCalled();
  });

  it('throws ExitError without running either runner when none is eligible', async () => {
    await expect(runTests(baseOpts)).rejects.toThrow('No test runner found');
    expect(mockRunJest).not.toHaveBeenCalled();
    expect(mockRunVitest).not.toHaveBeenCalled();
  });
});
