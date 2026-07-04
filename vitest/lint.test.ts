/**
 * @file vitest/lint.test.ts
 * @description This file contains the tests for the linter selection utility.
 * @author Luca Liguori
 */

// oxlint-disable unicorn/no-useless-undefined -- typed vitest mocks require the explicit undefined resolve/return value

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runLinter } from '../src/lint.js';
import { ExitError } from '../src/spawn.js';

vi.mock('../src/build.js', () => ({
  binExists: vi.fn(),
}));

vi.mock('../src/oxlint.js', () => ({
  runOxLint: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/eslint.js', () => ({
  runEsLint: vi.fn().mockResolvedValue(undefined),
}));

const { binExists } = await import('../src/build.js');
const { runOxLint } = await import('../src/oxlint.js');
const { runEsLint } = await import('../src/eslint.js');

const mockBinExists = vi.mocked(binExists);
const mockRunOxLint = vi.mocked(runOxLint);
const mockRunEsLint = vi.mocked(runEsLint);

const baseOpts = { rootDir: '/repo', isWindows: false, dryRun: false, fix: false };

describe('lint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunOxLint.mockResolvedValue(undefined);
    mockRunEsLint.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runLinter — tool selection', () => {
    it('uses oxlint when oxlint is installed', async () => {
      mockBinExists.mockResolvedValue(true);
      await runLinter(baseOpts);
      expect(mockRunOxLint).toHaveBeenCalledOnce();
      expect(mockRunEsLint).not.toHaveBeenCalled();
    });

    it('checks oxlint before eslint', async () => {
      mockBinExists.mockResolvedValue(true);
      await runLinter(baseOpts);
      expect(mockBinExists.mock.calls[0][0]).toBe('oxlint');
    });

    it('falls back to eslint when oxlint is missing', async () => {
      mockBinExists.mockImplementation(async (name) => name === 'eslint');
      await runLinter(baseOpts);
      expect(mockRunEsLint).toHaveBeenCalledOnce();
      expect(mockRunOxLint).not.toHaveBeenCalled();
    });

    it('throws ExitError when neither oxlint nor eslint is installed', async () => {
      mockBinExists.mockResolvedValue(false);
      await expect(runLinter(baseOpts)).rejects.toBeInstanceOf(ExitError);
    });

    it('does not call any linter when neither is installed', async () => {
      mockBinExists.mockResolvedValue(false);
      await expect(runLinter(baseOpts)).rejects.toThrow();
      expect(mockRunOxLint).not.toHaveBeenCalled();
      expect(mockRunEsLint).not.toHaveBeenCalled();
    });
  });

  describe('runLinter — option forwarding', () => {
    it('forwards the full options (including fix) to oxlint', async () => {
      mockBinExists.mockResolvedValue(true);
      await runLinter({ ...baseOpts, fix: true });
      expect(mockRunOxLint).toHaveBeenCalledWith(expect.objectContaining({ rootDir: '/repo', fix: true }));
    });

    it('forwards the full options (including fix) to eslint when it is the fallback', async () => {
      mockBinExists.mockImplementation(async (name) => name === 'eslint');
      await runLinter({ ...baseOpts, fix: true });
      expect(mockRunEsLint).toHaveBeenCalledWith(expect.objectContaining({ rootDir: '/repo', fix: true }));
    });
  });
});
