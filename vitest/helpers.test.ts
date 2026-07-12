/**
 * @file vitest/helpers.test.ts
 * @description This file contains the tests for the shared helper utilities.
 * @author Luca Liguori
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hasOxc, isLibrary, isMonorepo, isPlugin, parsePackageJson, removeFile } from '../src/helpers.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    // oxlint-disable-next-line typescript/promise-function-async -- passthrough mock; marking it async would only trip require-await
    readFile: vi.fn((...args: Parameters<typeof actual.readFile>) => actual.readFile(...args)),
    readdir: vi.fn(actual.readdir),
  };
});

vi.mock('../src/logger.js', () => ({
  logDelete: vi.fn(),
}));

const { logDelete } = await import('../src/logger.js');

let tmpDir: string;

describe('helpers', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-helpers-'));
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-package' }));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('isPlugin', () => {
    it('returns true when scripts.start is matterbridge', async () => {
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-plugin', scripts: { start: 'matterbridge' } }));
      expect(await isPlugin(tmpDir)).toBe(true);
    });

    it('returns true when scripts.dev:link is the matterbridge npm link command', async () => {
      await writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'my-plugin',
          scripts: { 'dev:link': 'npm link --no-fund --no-audit matterbridge' },
        }),
      );
      expect(await isPlugin(tmpDir)).toBe(true);
    });

    it('returns false when scripts.start is something else', async () => {
      await writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'my-tool',
          scripts: { start: 'node dist/bin/hello.js' },
        }),
      );
      expect(await isPlugin(tmpDir)).toBe(false);
    });

    it('returns false when there are no scripts', async () => {
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-lib' }));
      expect(await isPlugin(tmpDir)).toBe(false);
    });

    it('returns false for an empty scripts object', async () => {
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-lib', scripts: {} }));
      expect(await isPlugin(tmpDir)).toBe(false);
    });

    it('returns false when dev:link value does not match exactly', async () => {
      await writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'my-lib',
          scripts: { 'dev:link': 'npm link matterbridge' },
        }),
      );
      expect(await isPlugin(tmpDir)).toBe(false);
    });
  });

  describe('removeFile', () => {
    it('logs and removes an existing file', async () => {
      const filePath = path.join(tmpDir, 'remove-me.txt');
      await writeFile(filePath, 'temporary');
      await removeFile(filePath, { dryRun: false });
      expect(logDelete).toHaveBeenCalledWith(filePath);
      const { access } = await import('node:fs/promises');
      await expect(access(filePath)).rejects.toThrow();
    });

    it('logs but preserves the file in dry-run mode', async () => {
      const filePath = path.join(tmpDir, 'keep-me.txt');
      await writeFile(filePath, 'temporary');
      await removeFile(filePath, { dryRun: true });
      expect(logDelete).toHaveBeenCalledWith(filePath);
      const { access } = await import('node:fs/promises');
      await expect(access(filePath)).resolves.toBeUndefined();
    });
  });

  describe('hasOxc', () => {
    it('returns true when oxfmt and oxlint are dev dependencies', async () => {
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ devDependencies: { oxfmt: '^0.56.0', oxlint: '^1.71.0' } }));
      expect(await hasOxc(tmpDir)).toBe(true);
    });

    it('returns false when either Oxc package is missing', async () => {
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ devDependencies: { oxfmt: '^0.56.0' } }));
      expect(await hasOxc(tmpDir)).toBe(false);
    });

    it('returns false when devDependencies is absent', async () => {
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-package' }));
      expect(await hasOxc(tmpDir)).toBe(false);
    });
  });

  describe('isLibrary', () => {
    const libraryOptions = {
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      removeComments: false,
    };

    it('returns true when all four compiler options match the library pattern', async () => {
      await writeFile(path.join(tmpDir, 'tsconfig.build.production.json'), JSON.stringify({ compilerOptions: libraryOptions }));
      expect(await isLibrary(tmpDir)).toBe(true);
    });

    it('returns true when automator.library is true without a production tsconfig', async () => {
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ automator: { library: true } }));

      expect(await isLibrary(tmpDir)).toBe(true);
    });

    it('returns false when declaration is false', async () => {
      await writeFile(
        path.join(tmpDir, 'tsconfig.build.production.json'),
        JSON.stringify({
          compilerOptions: { ...libraryOptions, declaration: false },
        }),
      );
      expect(await isLibrary(tmpDir)).toBe(false);
    });

    it('returns false when declarationMap is false', async () => {
      await writeFile(
        path.join(tmpDir, 'tsconfig.build.production.json'),
        JSON.stringify({
          compilerOptions: { ...libraryOptions, declarationMap: false },
        }),
      );
      expect(await isLibrary(tmpDir)).toBe(false);
    });

    it('returns false when sourceMap is false', async () => {
      await writeFile(
        path.join(tmpDir, 'tsconfig.build.production.json'),
        JSON.stringify({
          compilerOptions: { ...libraryOptions, sourceMap: false },
        }),
      );
      expect(await isLibrary(tmpDir)).toBe(false);
    });

    it('returns false when removeComments is true', async () => {
      await writeFile(
        path.join(tmpDir, 'tsconfig.build.production.json'),
        JSON.stringify({
          compilerOptions: { ...libraryOptions, removeComments: true },
        }),
      );
      expect(await isLibrary(tmpDir)).toBe(false);
    });

    it('returns false when compilerOptions is absent', async () => {
      await writeFile(path.join(tmpDir, 'tsconfig.build.production.json'), JSON.stringify({}));
      expect(await isLibrary(tmpDir)).toBe(false);
    });

    it('falls back to the production tsconfig when automator.library is not true', async () => {
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ automator: [] }));
      await writeFile(path.join(tmpDir, 'tsconfig.build.production.json'), JSON.stringify({ compilerOptions: { ...libraryOptions, declaration: false } }));

      expect(await isLibrary(tmpDir)).toBe(false);

      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ automator: null }));
      expect(await isLibrary(tmpDir)).toBe(false);

      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ automator: { library: false } }));
      expect(await isLibrary(tmpDir)).toBe(false);
    });

    it('returns false when tsconfig.build.production.json does not exist', async () => {
      expect(await isLibrary(tmpDir)).toBe(false);
    });
  });

  describe('isMonorepo', () => {
    it('returns true when workspaces is an array', async () => {
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-monorepo', workspaces: ['packages/*'] }));
      expect(await isMonorepo(tmpDir)).toBe(true);
    });

    it('returns true when workspaces is an object', async () => {
      await writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'my-monorepo',
          workspaces: { packages: ['packages/*'] },
        }),
      );
      expect(await isMonorepo(tmpDir)).toBe(true);
    });

    it('returns false when workspaces key is absent', async () => {
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-lib' }));
      expect(await isMonorepo(tmpDir)).toBe(false);
    });

    it('returns false for an empty package.json object', async () => {
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({}));
      expect(await isMonorepo(tmpDir)).toBe(false);
    });
  });

  describe('parsePackageJson', () => {
    it('returns the parsed package.json as a plain object', async () => {
      const pkg = {
        name: 'my-pkg',
        version: '1.0.0',
        scripts: { start: 'node dist/index.js' },
      };
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));
      await expect(parsePackageJson(tmpDir)).resolves.toMatchObject(pkg);
    });

    it('throws when the file does not exist', async () => {
      await expect(parsePackageJson(path.join(tmpDir, 'nonexistent'))).rejects.toThrow('Failed to read or parse');
    });

    it('throws when the file contains invalid JSON', async () => {
      await writeFile(path.join(tmpDir, 'package.json'), '{ invalid json }');
      await expect(parsePackageJson(tmpDir)).rejects.toThrow('Failed to read or parse');
    });

    it('error message includes the package.json path', async () => {
      const expectedPath = path.join(tmpDir, 'nonexistent', 'package.json');
      await expect(parsePackageJson(path.join(tmpDir, 'nonexistent'))).rejects.toThrow(expectedPath);
    });

    it('includes a non-Error thrown value as a string in the message', async () => {
      const fsp = await import('node:fs/promises');
      vi.mocked(fsp.readFile).mockRejectedValueOnce('disk failure');
      await expect(parsePackageJson(tmpDir)).rejects.toThrow('disk failure');
    });
  });
});
