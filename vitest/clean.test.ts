import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CleanOptions } from '../src/clean.js';
import { cleanOnly, fileExists, resetClean } from '../src/clean.js';
import { initLogger } from '../src/logger.js';

let tmpDir: string;
let lines: string[] = [];

function makeOpts(overrides?: Partial<CleanOptions>): CleanOptions {
  return {
    rootDir: tmpDir,
    dryRun: false,
    ...overrides,
  };
}

beforeEach(async () => {
  lines = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(String(args[0]));
  });
  initLogger({ dryRun: false, verbose: false, rootDir: tmpDir ?? '' });
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-clean-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('fileExists', () => {
  it('returns true for an existing directory', async () => {
    expect(await fileExists(tmpDir)).toBe(true);
  });

  it('returns true for an existing file', async () => {
    const file = path.join(tmpDir, 'file.txt');
    await writeFile(file, '');
    expect(await fileExists(file)).toBe(true);
  });

  it('returns false for a non-existent path', async () => {
    expect(await fileExists(path.join(tmpDir, 'nonexistent'))).toBe(false);
  });
});

describe('cleanOnly', () => {
  it('removes build and dist directories', async () => {
    await mkdir(path.join(tmpDir, 'build'));
    await mkdir(path.join(tmpDir, 'dist'));

    await cleanOnly(makeOpts());

    expect(await fileExists(path.join(tmpDir, 'build'))).toBe(false);
    expect(await fileExists(path.join(tmpDir, 'dist'))).toBe(false);
  });

  it('removes dist-jest, coverage, jest, temp directories', async () => {
    for (const dir of ['dist-jest', 'coverage', 'jest', 'temp']) {
      await mkdir(path.join(tmpDir, dir));
    }

    await cleanOnly(makeOpts());

    for (const dir of ['dist-jest', 'coverage', 'jest', 'temp']) {
      expect(await fileExists(path.join(tmpDir, dir))).toBe(false);
    }
  });

  it('removes npm-shrinkwrap.json', async () => {
    const shrinkwrap = path.join(tmpDir, 'npm-shrinkwrap.json');
    await writeFile(shrinkwrap, '{}');

    await cleanOnly(makeOpts());

    expect(await fileExists(shrinkwrap)).toBe(false);
  });

  it('removes .tsbuildinfo files recursively', async () => {
    const subDir = path.join(tmpDir, 'src');
    await mkdir(subDir);
    const tsBuild = path.join(tmpDir, 'root.tsbuildinfo');
    const tsBuildNested = path.join(subDir, 'nested.tsbuildinfo');
    await writeFile(tsBuild, '');
    await writeFile(tsBuildNested, '');

    await cleanOnly(makeOpts());

    expect(await fileExists(tsBuild)).toBe(false);
    expect(await fileExists(tsBuildNested)).toBe(false);
  });

  it('does not scan node_modules for .tsbuildinfo files', async () => {
    const nodeModules = path.join(tmpDir, 'node_modules');
    await mkdir(nodeModules);
    const skipped = path.join(nodeModules, 'skipped.tsbuildinfo');
    await writeFile(skipped, '');

    await cleanOnly(makeOpts());

    // node_modules is skipped by removeTsBuildInfo, but NOT by cleanOnly's removePath calls
    // cleanOnly does NOT remove node_modules (only resetClean empties it)
    expect(await fileExists(nodeModules)).toBe(true);
    expect(await fileExists(skipped)).toBe(true);
  });

  it('empties .cache directory without removing it when it exists', async () => {
    const cache = path.join(tmpDir, '.cache');
    await mkdir(cache);
    await writeFile(path.join(cache, 'cached.txt'), '');

    await cleanOnly(makeOpts());

    expect(await fileExists(cache)).toBe(true);
    const entries = await readdir(cache);
    expect(entries).toHaveLength(0);
  });

  it('skips missing packages and apps workspace directories silently', async () => {
    // packages/ and apps/ do not exist — should not throw
    await expect(cleanOnly(makeOpts())).resolves.toBeUndefined();
  });

  it('tolerates a non-existent rootDir in tsbuildinfo scan without throwing', async () => {
    const opts = makeOpts({ rootDir: path.join(tmpDir, 'nonexistent') });
    await expect(cleanOnly(opts)).resolves.toBeUndefined();
  });

  it('cleans artifacts inside workspace directories', async () => {
    const wsRoot = path.join(tmpDir, 'packages', 'ws1');
    await mkdir(path.join(wsRoot, 'build'), { recursive: true });
    await mkdir(path.join(wsRoot, 'dist'), { recursive: true });
    await writeFile(path.join(wsRoot, 'package-lock.json'), '{}');

    await cleanOnly(makeOpts());

    expect(await fileExists(path.join(wsRoot, 'build'))).toBe(false);
    expect(await fileExists(path.join(wsRoot, 'dist'))).toBe(false);
    expect(await fileExists(path.join(wsRoot, 'package-lock.json'))).toBe(false);
  });

  it('does not remove root node_modules', async () => {
    await mkdir(path.join(tmpDir, 'node_modules'));

    await cleanOnly(makeOpts());

    expect(await fileExists(path.join(tmpDir, 'node_modules'))).toBe(true);
  });

  it('calls logDelete for each path that would be removed', async () => {
    await mkdir(path.join(tmpDir, 'build'));
    initLogger({ dryRun: true, verbose: false, rootDir: tmpDir });

    await cleanOnly(makeOpts({ dryRun: true }));

    expect(lines.some((l) => l.includes('build'))).toBe(true);
  });

  it('with dryRun=true does not delete any files', async () => {
    await mkdir(path.join(tmpDir, 'build'));
    await mkdir(path.join(tmpDir, 'dist'));

    await cleanOnly(makeOpts({ dryRun: true }));

    expect(await fileExists(path.join(tmpDir, 'build'))).toBe(true);
    expect(await fileExists(path.join(tmpDir, 'dist'))).toBe(true);
  });
});

describe('resetClean', () => {
  it('removes build and dist directories like cleanOnly', async () => {
    await mkdir(path.join(tmpDir, 'build'));
    await mkdir(path.join(tmpDir, 'dist'));

    await resetClean(makeOpts());

    expect(await fileExists(path.join(tmpDir, 'build'))).toBe(false);
    expect(await fileExists(path.join(tmpDir, 'dist'))).toBe(false);
  });

  it('empties node_modules without deleting the directory', async () => {
    const nodeModules = path.join(tmpDir, 'node_modules');
    await mkdir(path.join(nodeModules, 'pkg'), { recursive: true });

    await resetClean(makeOpts());

    expect(await fileExists(nodeModules)).toBe(true);
    const entries = await readdir(nodeModules);
    expect(entries).toHaveLength(0);
  });

  it('with dryRun=true skips non-existent node_modules without logging', async () => {
    await resetClean(makeOpts({ dryRun: true }));

    expect(await fileExists(path.join(tmpDir, 'node_modules'))).toBe(false);
  });

  it('with dryRun=true empties existing node_modules by logging deletes only', async () => {
    const nodeModules = path.join(tmpDir, 'node_modules');
    await mkdir(path.join(nodeModules, 'pkg'), { recursive: true });
    initLogger({ dryRun: true, verbose: false, rootDir: tmpDir });

    await resetClean(makeOpts({ dryRun: true }));

    // node_modules itself should still exist and pkg should still be inside it
    expect(await fileExists(nodeModules)).toBe(true);
    expect(await fileExists(path.join(nodeModules, 'pkg'))).toBe(true);
    expect(lines.some((l) => l.includes('pkg'))).toBe(true);
  });
});
