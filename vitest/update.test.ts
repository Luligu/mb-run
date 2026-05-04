import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runUpdate } from '../src/update.js';

vi.mock('npm-check-updates', () => ({
  run: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/helpers.js', () => ({
  parsePackageJson: vi.fn(),
}));

const { run: ncuRun } = await import('npm-check-updates');
const { parsePackageJson } = await import('../src/helpers.js');

const mockNcuRun = vi.mocked(ncuRun);
const mockParsePackageJson = vi.mocked(parsePackageJson);

const rootDir = '/fake/root';
const baseOpts = { rootDir, isWindows: false, dryRun: false };

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockNcuRun.mockResolvedValue(undefined);
  mockParsePackageJson.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runUpdate', () => {
  describe('dryRun: true', () => {
    it('returns early without calling ncuRun', async () => {
      await runUpdate({ ...baseOpts, dryRun: true });
      expect(mockNcuRun).not.toHaveBeenCalled();
    });

    it('returns early without reading package.json', async () => {
      await runUpdate({ ...baseOpts, dryRun: true });
      expect(mockParsePackageJson).not.toHaveBeenCalled();
    });
  });

  describe('plain package (no workspaces field)', () => {
    it('calls ncuRun without workspace options', async () => {
      mockParsePackageJson.mockResolvedValue({ name: 'my-pkg', version: '1.0.0' });
      await runUpdate(baseOpts);
      expect(mockNcuRun).toHaveBeenCalledOnce();
      expect(mockNcuRun).toHaveBeenCalledWith({ upgrade: true, silent: true, cwd: rootDir });
    });
  });

  describe('workspace package (workspaces is a non-empty array)', () => {
    it('calls ncuRun with workspaces and root options', async () => {
      mockParsePackageJson.mockResolvedValue({ name: 'my-ws', workspaces: ['packages/*'] });
      await runUpdate(baseOpts);
      expect(mockNcuRun).toHaveBeenCalledOnce();
      expect(mockNcuRun).toHaveBeenCalledWith({ upgrade: true, workspaces: true, root: true, silent: true, cwd: rootDir });
    });

    it('passes the rootDir as cwd', async () => {
      mockParsePackageJson.mockResolvedValue({ workspaces: ['packages/a', 'packages/b'] });
      const customRoot = '/custom/workspace';
      await runUpdate({ ...baseOpts, rootDir: customRoot });
      expect(mockNcuRun).toHaveBeenCalledWith(expect.objectContaining({ cwd: customRoot }));
    });
  });

  describe('empty workspaces array', () => {
    it('treats an empty workspaces array as a plain package', async () => {
      mockParsePackageJson.mockResolvedValue({ workspaces: [] });
      await runUpdate(baseOpts);
      expect(mockNcuRun).toHaveBeenCalledWith({ upgrade: true, silent: true, cwd: rootDir });
    });
  });

  describe('non-array workspaces field', () => {
    it('treats a non-array workspaces field as a plain package', async () => {
      mockParsePackageJson.mockResolvedValue({ workspaces: 'packages/*' });
      await runUpdate(baseOpts);
      expect(mockNcuRun).toHaveBeenCalledWith({ upgrade: true, silent: true, cwd: rootDir });
    });

    it('treats an object workspaces field as a plain package', async () => {
      mockParsePackageJson.mockResolvedValue({ workspaces: { packages: ['packages/*'] } });
      await runUpdate(baseOpts);
      expect(mockNcuRun).toHaveBeenCalledWith({ upgrade: true, silent: true, cwd: rootDir });
    });
  });
});
