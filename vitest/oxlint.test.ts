/**
 * @file vitest/oxlint.test.ts
 * @description This file contains the tests for the oxlint linting utilities.
 * @author Luca Liguori
 */

// oxlint-disable unicorn/no-useless-undefined -- typed vitest mocks require the explicit undefined resolve/return value

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runOxLint } from '../src/oxlint.js';

vi.mock('../src/build.js', () => ({
  runBin: vi.fn().mockResolvedValue(undefined),
}));

const { runBin } = await import('../src/build.js');
const mockRunBin = vi.mocked(runBin);

let tmpDir: string;

describe('oxlint', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-oxlint-'));
    mockRunBin.mockClear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // config selection
  // ---------------------------------------------------------------------------
  describe('runOxLint — config selection', () => {
    it('uses the project .oxlintrc.json when present', async () => {
      await writeFile(path.join(tmpDir, '.oxlintrc.json'), '{}', 'utf8');
      await runOxLint({ rootDir: tmpDir, isWindows: false, dryRun: false, fix: false });
      const args = mockRunBin.mock.calls[0][1];
      expect(args[1]).toBe(path.join(tmpDir, '.oxlintrc.json'));
    });

    it('uses the vendor fallback when no project .oxlintrc.json exists', async () => {
      await runOxLint({ rootDir: tmpDir, isWindows: false, dryRun: false, fix: false });
      const args = mockRunBin.mock.calls[0][1];
      expect(args[1]).toMatch(/vendor[/\\]\.oxlintrc\.root\.json$/u);
    });

    it('vendor fallback path resolves to an existing file', async () => {
      const { access } = await import('node:fs/promises');
      await runOxLint({ rootDir: tmpDir, isWindows: false, dryRun: false, fix: false });
      const configPath = mockRunBin.mock.calls[0][1][1];
      await expect(access(configPath)).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // runBin invocation
  // ---------------------------------------------------------------------------
  describe('runOxLint — runBin invocation', () => {
    it('calls runBin with oxlint as the binary name', async () => {
      await runOxLint({ rootDir: tmpDir, isWindows: false, dryRun: false, fix: false });
      expect(mockRunBin).toHaveBeenCalledOnce();
      expect(mockRunBin.mock.calls[0][0]).toBe('oxlint');
    });

    it('passes -c as the first arg without an explicit target', async () => {
      await runOxLint({ rootDir: tmpDir, isWindows: false, dryRun: false, fix: false });
      const args = mockRunBin.mock.calls[0][1];
      expect(args[0]).toBe('-c');
      expect(args).not.toContain('.');
    });

    it('omits --fix when fix is false', async () => {
      await runOxLint({ rootDir: tmpDir, isWindows: false, dryRun: false, fix: false });
      const args = mockRunBin.mock.calls[0][1];
      expect(args).not.toContain('--fix');
    });

    it('adds --fix when fix is true', async () => {
      await runOxLint({ rootDir: tmpDir, isWindows: false, dryRun: false, fix: true });
      const args = mockRunBin.mock.calls[0][1];
      expect(args).toContain('--fix');
    });

    it('forwards rootDir to runBin options', async () => {
      await runOxLint({ rootDir: tmpDir, isWindows: false, dryRun: false, fix: false });
      const opts = mockRunBin.mock.calls[0][2];
      expect(opts.rootDir).toBe(tmpDir);
    });

    it('forwards isWindows to runBin options', async () => {
      await runOxLint({ rootDir: tmpDir, isWindows: true, dryRun: false, fix: false });
      const opts = mockRunBin.mock.calls[0][2];
      expect(opts.isWindows).toBe(true);
    });

    it('forwards dryRun to runBin options', async () => {
      await runOxLint({ rootDir: tmpDir, isWindows: false, dryRun: true, fix: false });
      const opts = mockRunBin.mock.calls[0][2];
      expect(opts.dryRun).toBe(true);
    });
  });
});
