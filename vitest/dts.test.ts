/**
 * @file vitest/dts.test.ts
 * @description This file contains the tests for the declaration-bundling utilities.
 * @author Luca Liguori
 */

// oxlint-disable unicorn/no-useless-undefined -- mocked Rollup bundle methods resolve without a value

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runDtsBundle } from '../src/dts.js';

vi.mock('rollup', () => ({ rollup: vi.fn() }));
vi.mock('rollup-plugin-dts', () => ({ dts: vi.fn(() => ({ name: 'dts' })) }));

import { rollup } from 'rollup';
import { dts } from 'rollup-plugin-dts';

const mockedRollup = vi.mocked(rollup);
const mockedDts = vi.mocked(dts);

let tmpDir: string;

describe('dts', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-dts-'));
    mockedRollup.mockClear();
    mockedDts.mockClear();
    mockedRollup.mockResolvedValue({
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Write a package.json file.
   *
   * @param {string} directory Directory containing the package.json file.
   * @param {Record<string, unknown>} packageJson Package metadata to write.
   * @returns {Promise<void>} Resolves after the package metadata is written.
   */
  async function writePackageJson(directory: string, packageJson: Record<string, unknown>): Promise<void> {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'package.json'), JSON.stringify(packageJson));
  }

  /**
   * Write a declaration file.
   *
   * @param {string} filePath Declaration file path.
   * @returns {Promise<void>} Resolves after the declaration file is written.
   */
  async function writeDeclaration(filePath: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, 'export {};\n');
  }

  it('bundles every distinct public declaration file and inlines workspace imports', async () => {
    await writePackageJson(tmpDir, {
      name: 'root',
      types: './dist/export.d.ts',
      workspaces: ['packages/*'],
      exports: {
        '.': { import: './dist/export.js', types: './dist/export.d.ts' },
        './utils': { import: './dist/utils/export.js', types: './dist/utils/export.d.ts' },
        './without-types': {},
        './string': './dist/string.js',
        './null': null,
      },
    });
    await writePackageJson(path.join(tmpDir, 'packages', 'utils'), {
      name: '@root/utils',
      types: './dist/export.d.ts',
      exports: {
        '.': { types: './dist/export.d.ts' },
        './format': { types: './dist/format.d.ts' },
        './without-types': {},
        './string': './dist/string.js',
        './null': null,
      },
    });
    await writePackageJson(path.join(tmpDir, 'packages', 'nameless'), {});
    await writePackageJson(path.join(tmpDir, 'packages', 'without-types'), { name: '@root/without-types', exports: [] });
    await writeDeclaration(path.join(tmpDir, 'dist', 'export.d.ts'));
    await writeDeclaration(path.join(tmpDir, 'dist', 'utils', 'export.d.ts'));
    await writeDeclaration(path.join(tmpDir, 'packages', 'utils', 'dist', 'export.d.ts'));
    await writeDeclaration(path.join(tmpDir, 'packages', 'utils', 'dist', 'format.d.ts'));

    await runDtsBundle({ rootDir: tmpDir, dryRun: false });

    expect(mockedRollup).toHaveBeenCalledTimes(2);
    expect(mockedDts).toHaveBeenCalledWith(
      expect.objectContaining({
        respectExternal: true,
        compilerOptions: expect.objectContaining({
          baseUrl: tmpDir,
          paths: expect.objectContaining({
            '@root/utils': ['packages/utils/dist/export.d.ts'],
            '@root/utils/format': ['packages/utils/dist/format.d.ts'],
          }),
        }),
      }),
    );
    const rollupOptions = mockedRollup.mock.calls[0][0];
    const external = rollupOptions.external;
    expect(typeof external).toBe('function');
    if (typeof external !== 'function') throw new Error('Expected a Rollup external predicate');
    expect(external('@root/utils', '', false)).toBe(false);
    expect(external('@root/utils/format', '', false)).toBe(false);
    expect(external('typescript', '', false)).toBe(true);
    expect(external('./local', '', false)).toBe(false);
  });

  it('skips bundling when dry-run is enabled or no declarations are published', async () => {
    await runDtsBundle({ rootDir: tmpDir, dryRun: true });
    expect(mockedRollup).not.toHaveBeenCalled();

    await writePackageJson(tmpDir, { name: 'root' });
    await runDtsBundle({ rootDir: tmpDir, dryRun: false });
    expect(mockedRollup).not.toHaveBeenCalled();
  });

  it('rejects a missing published declaration file', async () => {
    await writePackageJson(tmpDir, { name: 'root', types: './dist/missing.d.ts' });

    await expect(runDtsBundle({ rootDir: tmpDir, dryRun: false })).rejects.toThrow('Missing declaration file');
  });
});
