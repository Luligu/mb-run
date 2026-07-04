/**
 * @file vitest/oxfmt.test.ts
 * @description This file contains the tests for the oxfmt formatting utilities.
 * @author Luca Liguori
 */

// oxlint-disable unicorn/no-useless-undefined -- typed vitest mocks require the explicit undefined resolve/return value

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runOxFormat } from '../src/oxfmt.js';

vi.mock('../src/build.js', () => ({
  runBin: vi.fn().mockResolvedValue(undefined),
}));

const { runBin } = await import('../src/build.js');
const mockRunBin = vi.mocked(runBin);

let tmpDir: string;

describe('oxfmt', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-oxfmt-'));
    mockRunBin.mockClear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // config selection
  // ---------------------------------------------------------------------------
  describe('runOxFormat — config selection', () => {
    it('uses the project .oxfmtrc.json when present', async () => {
      await writeFile(path.join(tmpDir, '.oxfmtrc.json'), '{}', 'utf8');
      await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false, check: false });
      const args = mockRunBin.mock.calls[0][1];
      expect(args[1]).toBe(path.join(tmpDir, '.oxfmtrc.json'));
    });

    it('uses the vendor fallback when no project .oxfmtrc.json exists', async () => {
      await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false, check: false });
      const args = mockRunBin.mock.calls[0][1];
      expect(args[1]).toMatch(/vendor[/\\]\.oxfmtrc\.root\.json$/u);
    });

    it('vendor fallback path resolves to an existing file', async () => {
      const { access } = await import('node:fs/promises');
      await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false, check: false });
      const configPath = mockRunBin.mock.calls[0][1][1];
      await expect(access(configPath)).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // runBin invocation
  // ---------------------------------------------------------------------------
  describe('runOxFormat — runBin invocation', () => {
    it('calls runBin with oxfmt as the binary name', async () => {
      await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false, check: false });
      expect(mockRunBin).toHaveBeenCalledOnce();
      expect(mockRunBin.mock.calls[0][0]).toBe('oxfmt');
    });

    it('passes -c as the first arg without an explicit target', async () => {
      await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false, check: false });
      const args = mockRunBin.mock.calls[0][1];
      expect(args[0]).toBe('-c');
      expect(args).not.toContain('.');
    });

    it('uses --write when check is false', async () => {
      await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false, check: false });
      const args = mockRunBin.mock.calls[0][1];
      expect(args).toContain('--write');
      expect(args).not.toContain('--check');
    });

    it('uses --check when check is true', async () => {
      await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false, check: true });
      const args = mockRunBin.mock.calls[0][1];
      expect(args).toContain('--check');
      expect(args).not.toContain('--write');
    });

    it('forwards rootDir to runBin options', async () => {
      await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false, check: false });
      const opts = mockRunBin.mock.calls[0][2];
      expect(opts.rootDir).toBe(tmpDir);
    });

    it('forwards isWindows to runBin options', async () => {
      await runOxFormat({ rootDir: tmpDir, isWindows: true, dryRun: false, check: false });
      const opts = mockRunBin.mock.calls[0][2];
      expect(opts.isWindows).toBe(true);
    });

    it('forwards dryRun to runBin options', async () => {
      await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: true, check: false });
      const opts = mockRunBin.mock.calls[0][2];
      expect(opts.dryRun).toBe(true);
    });
  });
});
