/**
 * @file vitest/dts.test.ts
 * @description This file contains the tests for the declaration-bundling utilities.
 * @author Luca Liguori
 */

import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runDtsBundle } from '../src/dts.js';

vi.mock('dts-bundle-generator', () => ({ generateDtsBundle: vi.fn() }));

import { generateDtsBundle } from 'dts-bundle-generator';

const mockedGenerateDtsBundle = vi.mocked(generateDtsBundle);

let tmpDir: string;

describe('dts', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-dts-'));
    mockedGenerateDtsBundle.mockClear();
    mockedGenerateDtsBundle.mockReturnValue(['export {};\n']);
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
    let capturedPaths: Record<string, string[]> = {};
    let capturedExtends = '';
    mockedGenerateDtsBundle.mockImplementation((_, options) => {
      if (options?.preferredConfigPath !== undefined) {
        const raw = readFileSync(options.preferredConfigPath, 'utf8');
        const config = JSON.parse(raw) as { extends?: string; compilerOptions?: { paths?: Record<string, string[]> } };
        capturedExtends = config.extends ?? '';
        capturedPaths = config.compilerOptions?.paths ?? {};
      }
      return ['export {};\n'];
    });

    await writeFile(path.join(tmpDir, 'tsconfig.build.production.json'), '{}\n');

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

    expect(mockedGenerateDtsBundle).toHaveBeenCalledTimes(2);
    const firstCallEntries = mockedGenerateDtsBundle.mock.calls[0][0];
    const firstCallOptions = mockedGenerateDtsBundle.mock.calls[0][1];
    expect(firstCallEntries).toEqual([{ filePath: path.join(tmpDir, 'dist', 'export.d.ts') }]);
    expect(firstCallOptions).toEqual(expect.objectContaining({ preferredConfigPath: path.join(tmpDir, '.mb-run.dts-bundle.tsconfig.json') }));
    expect(capturedPaths).toEqual(
      expect.objectContaining({
        '@root/utils': ['packages/utils/dist/export.d.ts'],
        '@root/utils/format': ['packages/utils/dist/format.d.ts'],
      }),
    );
    expect(capturedExtends).toBe('./tsconfig.build.production.json');
  });

  it('skips bundling when dry-run is enabled or no declarations are published', async () => {
    await runDtsBundle({ rootDir: tmpDir, dryRun: true });
    expect(mockedGenerateDtsBundle).not.toHaveBeenCalled();

    await writePackageJson(tmpDir, { name: 'root' });
    await runDtsBundle({ rootDir: tmpDir, dryRun: false });
    expect(mockedGenerateDtsBundle).not.toHaveBeenCalled();
  });

  it('rejects a missing published declaration file', async () => {
    await writePackageJson(tmpDir, { name: 'root', types: './dist/missing.d.ts' });

    await expect(runDtsBundle({ rootDir: tmpDir, dryRun: false })).rejects.toThrow('Missing declaration file');
  });

  it('rejects when declaration bundling produces no output', async () => {
    mockedGenerateDtsBundle.mockReturnValue([]);
    await writePackageJson(tmpDir, { name: 'root', types: './dist/export.d.ts' });
    await writeDeclaration(path.join(tmpDir, 'dist', 'export.d.ts'));

    await expect(runDtsBundle({ rootDir: tmpDir, dryRun: false })).rejects.toThrow('Failed to generate declaration bundle');
  });

  it('falls back to tsconfig.json when no preferred build tsconfig file exists', async () => {
    let capturedExtends = '';
    mockedGenerateDtsBundle.mockImplementation((_, options) => {
      if (options?.preferredConfigPath !== undefined) {
        const raw = readFileSync(options.preferredConfigPath, 'utf8');
        const config = JSON.parse(raw) as { extends?: string };
        capturedExtends = config.extends ?? '';
      }
      return ['export {};\n'];
    });

    await writePackageJson(tmpDir, {
      name: 'root',
      types: './dist/export.d.ts',
      workspaces: ['packages/*'],
    });
    await writePackageJson(path.join(tmpDir, 'packages', 'utils'), {
      name: '@root/utils',
      types: './dist/export.d.ts',
    });
    await writeDeclaration(path.join(tmpDir, 'dist', 'export.d.ts'));
    await writeDeclaration(path.join(tmpDir, 'packages', 'utils', 'dist', 'export.d.ts'));

    await runDtsBundle({ rootDir: tmpDir, dryRun: false });

    expect(capturedExtends).toBe('./tsconfig.json');
  });

  it('bundles declarations without temp tsconfig when no workspace mappings are present', async () => {
    mockedGenerateDtsBundle.mockReturnValue(['export {}']);
    const declarationPath = path.join(tmpDir, 'dist', 'export.d.ts');
    await writePackageJson(tmpDir, { name: 'root', types: './dist/export.d.ts' });
    await writeDeclaration(path.join(tmpDir, 'dist', 'export.d.ts'));

    await runDtsBundle({ rootDir: tmpDir, dryRun: false });

    const firstCallOptions = mockedGenerateDtsBundle.mock.calls[0]?.[1];
    expect(firstCallOptions).toBeUndefined();
    await expect(readFile(declarationPath, 'utf8')).resolves.toBe('export {}\n');
  });
});
