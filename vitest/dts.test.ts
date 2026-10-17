/**
 * @file vitest/dts.test.ts
 * @description This file contains the tests for the declaration build and bundling utilities.
 * @author Luca Liguori
 */

// oxlint-disable unicorn/no-useless-undefined -- mocked Rollup bundle methods resolve without a value

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runDtsBuild, runDtsBundle } from '../src/dts.js';

vi.mock('../src/build.js', () => ({
  runBin: vi.fn().mockImplementation(async () => {}),
}));

vi.mock('../src/helpers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/helpers.js')>()),
  isMonorepo: vi.fn().mockResolvedValue(false),
}));

vi.mock('rollup', () => ({ rollup: vi.fn() }));
vi.mock('rollup-plugin-dts', () => ({ dts: vi.fn(() => ({ name: 'dts' })) }));

const { runBin } = await import('../src/build.js');
const { isMonorepo } = await import('../src/helpers.js');
const { rollup } = await import('rollup');
const { dts } = await import('rollup-plugin-dts');

const mockRunBin = vi.mocked(runBin);
const mockIsMonorepo = vi.mocked(isMonorepo);
const mockedRollup = vi.mocked(rollup);
const mockedDts = vi.mocked(dts);

let tmpDir: string;

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

describe('dts', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-dts-'));
    mockRunBin.mockClear();
    mockIsMonorepo.mockClear();
    mockRunBin.mockImplementation(async () => {});
    mockIsMonorepo.mockResolvedValue(false);
    mockedRollup.mockClear();
    mockedDts.mockClear();
    mockedRollup.mockResolvedValue({
      write: vi.fn().mockResolvedValue({ output: [] }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);
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
      ['--build', path.join(tmpDir, 'tsconfig.build.json'), '--force', '--declaration', '--declarationMap', 'false', '--emitDeclarationOnly'],
      { rootDir: tmpDir, isWindows: true, dryRun: false, mode: 'build', watch: false },
    );
  });

  it('should pass dry-run through to the TypeScript command runner when enabled', async () => {
    await runDtsBuild({ rootDir: tmpDir, isWindows: false, dryRun: true });

    expect(mockRunBin).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ dryRun: true }));
  });

  it('should bundle every distinct public declaration file and inline workspace imports', async () => {
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

    const write = vi.fn().mockResolvedValue({ output: [{ fileName: 'dist/export.d.ts' }, { fileName: 'dist/utils/export.d.ts' }, { fileName: 'dist/_chunks/shared-abc.d.ts' }] });
    mockedRollup.mockResolvedValueOnce({ write, close: vi.fn().mockResolvedValue(undefined) } as never);

    const written = await runDtsBundle({ rootDir: tmpDir, dryRun: false });

    // One run over every entry, so shared declarations land in common chunks instead of being copied per entry.
    expect(mockedRollup).toHaveBeenCalledTimes(1);
    expect(mockedRollup.mock.calls[0][0].input).toEqual({
      'dist/export': path.join(tmpDir, 'dist', 'export.d.ts'),
      'dist/utils/export': path.join(tmpDir, 'dist', 'utils', 'export.d.ts'),
    });
    expect(write).toHaveBeenCalledWith({ dir: tmpDir, format: 'es', entryFileNames: '[name].d.ts', chunkFileNames: 'dist/_chunks/[name]-[hash].d.ts' });
    expect(written).toEqual([path.join(tmpDir, 'dist', 'export.d.ts'), path.join(tmpDir, 'dist', 'utils', 'export.d.ts'), path.join(tmpDir, 'dist', '_chunks', 'shared-abc.d.ts')]);
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

  it('should skip bundling when dry-run is enabled or no declarations are published', async () => {
    expect(await runDtsBundle({ rootDir: tmpDir, dryRun: true })).toEqual([]);
    expect(mockedRollup).not.toHaveBeenCalled();

    await writePackageJson(tmpDir, { name: 'root' });
    expect(await runDtsBundle({ rootDir: tmpDir, dryRun: false })).toEqual([]);
    expect(mockedRollup).not.toHaveBeenCalled();
  });

  it('should reject a missing published declaration file', async () => {
    await writePackageJson(tmpDir, { name: 'root', types: './dist/missing.d.ts' });

    await expect(runDtsBundle({ rootDir: tmpDir, dryRun: false })).rejects.toThrow('Missing declaration file');
  });
});
