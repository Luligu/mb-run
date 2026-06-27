// oxlint-disable unicorn/no-useless-undefined -- typed vitest mocks require the explicit undefined resolve/return value
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runFormatter } from '../src/format.js';
import { ExitError } from '../src/spawn.js';

vi.mock('../src/build.js', () => ({
  binExists: vi.fn(),
}));

vi.mock('../src/oxfmt.js', () => ({
  runOxFormat: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/prettier.js', () => ({
  runPrettier: vi.fn().mockResolvedValue(undefined),
}));

const { binExists } = await import('../src/build.js');
const { runOxFormat } = await import('../src/oxfmt.js');
const { runPrettier } = await import('../src/prettier.js');

const mockBinExists = vi.mocked(binExists);
const mockRunOxFormat = vi.mocked(runOxFormat);
const mockRunPrettier = vi.mocked(runPrettier);

const baseOpts = { rootDir: '/repo', isWindows: false, dryRun: false, check: false };

describe('format', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunOxFormat.mockResolvedValue(undefined);
    mockRunPrettier.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runFormatter — tool selection', () => {
    it('uses oxfmt when oxfmt is installed', async () => {
      mockBinExists.mockResolvedValue(true);
      await runFormatter(baseOpts);
      expect(mockRunOxFormat).toHaveBeenCalledOnce();
      expect(mockRunPrettier).not.toHaveBeenCalled();
    });

    it('checks oxfmt before prettier', async () => {
      mockBinExists.mockResolvedValue(true);
      await runFormatter(baseOpts);
      expect(mockBinExists.mock.calls[0][0]).toBe('oxfmt');
    });

    it('falls back to prettier when oxfmt is missing', async () => {
      mockBinExists.mockImplementation(async (name) => name === 'prettier');
      await runFormatter(baseOpts);
      expect(mockRunPrettier).toHaveBeenCalledOnce();
      expect(mockRunOxFormat).not.toHaveBeenCalled();
    });

    it('throws ExitError when neither oxfmt nor prettier is installed', async () => {
      mockBinExists.mockResolvedValue(false);
      await expect(runFormatter(baseOpts)).rejects.toBeInstanceOf(ExitError);
    });

    it('does not call any formatter when neither is installed', async () => {
      mockBinExists.mockResolvedValue(false);
      await expect(runFormatter(baseOpts)).rejects.toThrow();
      expect(mockRunOxFormat).not.toHaveBeenCalled();
      expect(mockRunPrettier).not.toHaveBeenCalled();
    });
  });

  describe('runFormatter — option forwarding', () => {
    it('forwards the full options (including check) to oxfmt', async () => {
      mockBinExists.mockResolvedValue(true);
      await runFormatter({ ...baseOpts, check: true });
      expect(mockRunOxFormat).toHaveBeenCalledWith(expect.objectContaining({ rootDir: '/repo', check: true }));
    });

    it('forwards the full options (including check) to prettier when it is the fallback', async () => {
      mockBinExists.mockImplementation(async (name) => name === 'prettier');
      await runFormatter({ ...baseOpts, check: true });
      expect(mockRunPrettier).toHaveBeenCalledWith(expect.objectContaining({ rootDir: '/repo', check: true }));
    });
  });
});
