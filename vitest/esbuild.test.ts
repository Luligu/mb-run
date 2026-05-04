import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runEsbuild } from '../src/esbuild.js';
import { initLogger } from '../src/logger.js';

// Mock esbuild so no real bundling happens.
vi.mock('esbuild', () => ({ build: vi.fn().mockResolvedValue({}) }));

import { build as mockBuild } from 'esbuild';

const mockedBuild = vi.mocked(mockBuild);

let tmpDir: string;

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  initLogger({ dryRun: false, verbose: false, rootDir: '' });
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-esbuild-'));
  mockedBuild.mockResolvedValue({} as Awaited<ReturnType<typeof mockBuild>>);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/**
 * Write a package.json to a directory.
 *
 * @param {string} dir Directory to write into.
 * @param {Record<string, unknown>} content Package.json content.
 */
async function writePkg(dir: string, content: Record<string, unknown>): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'package.json'), JSON.stringify(content));
}

/**
 * Write a TypeScript source file at the given path.
 *
 * @param {string} filePath Absolute path to the file to create.
 */
async function writeTs(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, '// stub\n');
}

// ---------------------------------------------------------------------------
// dryRun
// ---------------------------------------------------------------------------
describe('runEsbuild — dryRun', () => {
  it('returns immediately without calling esbuild.build when dryRun=true', async () => {
    await writePkg(tmpDir, { name: 'my-pkg', version: '1.0.0', main: './dist/module.js' });
    await writeTs(path.join(tmpDir, 'src', 'module.ts'));

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: true });

    expect(mockedBuild).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// main entry resolution
// ---------------------------------------------------------------------------
describe('runEsbuild — main entry resolution', () => {
  it('resolves main entry from the "main" field', async () => {
    await writePkg(tmpDir, { name: 'my-pkg', version: '1.0.0', main: './dist/module.js' });
    await writeTs(path.join(tmpDir, 'src', 'module.ts'));

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    expect(mockedBuild).toHaveBeenCalledOnce();
    const opts = mockedBuild.mock.calls[0][0] as { entryPoints: Array<{ in: string; out: string }> };
    expect(opts.entryPoints[0].out).toBe('module');
    expect(opts.entryPoints[0].in).toContain(path.join('src', 'module.ts'));
  });

  it('resolves main entry from exports["."]["import"] when "main" is absent', async () => {
    await writePkg(tmpDir, {
      name: 'my-pkg',
      version: '1.0.0',
      exports: { '.': { import: './dist/module.js' } },
    });
    await writeTs(path.join(tmpDir, 'src', 'module.ts'));

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    expect(mockedBuild).toHaveBeenCalledOnce();
    const opts = mockedBuild.mock.calls[0][0] as { entryPoints: Array<{ in: string; out: string }> };
    expect(opts.entryPoints[0].out).toBe('module');
  });

  it('throws when neither "main" nor exports["."]["import"] is present', async () => {
    await writePkg(tmpDir, { name: 'my-pkg', version: '1.0.0' });

    await expect(runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false })).rejects.toThrow('No main entry point');
  });
});

// ---------------------------------------------------------------------------
// external dependencies
// ---------------------------------------------------------------------------
describe('runEsbuild — external dependencies', () => {
  it('marks dependencies, optionalDependencies, and peerDependencies as external', async () => {
    await writePkg(tmpDir, {
      name: 'my-pkg',
      version: '1.0.0',
      main: './dist/module.js',
      dependencies: { lodash: '^4.0.0' },
      optionalDependencies: { fsevents: '*' },
      peerDependencies: { react: '^18.0.0' },
    });
    await writeTs(path.join(tmpDir, 'src', 'module.ts'));

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    const opts = mockedBuild.mock.calls[0][0] as { external: string[] };
    expect(opts.external).toContain('lodash');
    expect(opts.external).toContain('fsevents');
    expect(opts.external).toContain('react');
  });
});

// ---------------------------------------------------------------------------
// bin entries
// ---------------------------------------------------------------------------
describe('runEsbuild — bin entries', () => {
  it('includes a bin entry that maps to an existing TypeScript source file', async () => {
    await writePkg(tmpDir, {
      name: 'my-pkg',
      version: '1.0.0',
      main: './dist/module.js',
      bin: { 'my-cli': './dist/bin/cli.js' },
    });
    await writeTs(path.join(tmpDir, 'src', 'module.ts'));
    await writeTs(path.join(tmpDir, 'src', 'bin', 'cli.ts'));

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    const opts = mockedBuild.mock.calls[0][0] as { entryPoints: Array<{ in: string; out: string }> };
    const binEntry = opts.entryPoints.find((e) => e.out === 'bin/cli');
    expect(binEntry).toBeDefined();
    expect(binEntry?.in).toContain(path.join('src', 'bin', 'cli.ts'));
  });

  it('skips a shim bin path that does not produce a .ts derived source path', async () => {
    // "bin/my-run" has no dist/ prefix and no .js extension → toTsSrc leaves it as "bin/my-run" (no .ts)
    await writePkg(tmpDir, {
      name: 'my-pkg',
      version: '1.0.0',
      main: './dist/module.js',
      bin: { 'my-run': 'bin/my-run' },
    });
    await writeTs(path.join(tmpDir, 'src', 'module.ts'));

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    const opts = mockedBuild.mock.calls[0][0] as { entryPoints: Array<{ in: string; out: string }> };
    expect(opts.entryPoints).toHaveLength(1); // only main, bin skipped
  });

  it('deduplicates bin entries that resolve to the same file (line 118)', async () => {
    // Two different bin names pointing to the same dist file → only one entry expected.
    await writePkg(tmpDir, {
      name: 'my-pkg',
      version: '1.0.0',
      main: './dist/module.js',
      bin: {
        'cli-a': './dist/bin/cli.js',
        'cli-b': './dist/bin/cli.js',
      },
    });
    await writeTs(path.join(tmpDir, 'src', 'module.ts'));
    await writeTs(path.join(tmpDir, 'src', 'bin', 'cli.ts'));

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    const opts = mockedBuild.mock.calls[0][0] as { entryPoints: Array<{ in: string; out: string }> };
    const binEntries = opts.entryPoints.filter((e) => e.out.startsWith('bin/'));
    expect(binEntries).toHaveLength(1); // deduplicated — only one of cli-a / cli-b
  });

  it('skips a bin entry whose derived .ts source file does not exist on disk', async () => {
    await writePkg(tmpDir, {
      name: 'my-pkg',
      version: '1.0.0',
      main: './dist/module.js',
      bin: { 'missing-cli': './dist/bin/missing.js' },
    });
    await writeTs(path.join(tmpDir, 'src', 'module.ts'));
    // Note: src/bin/missing.ts is intentionally NOT written.

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    const opts = mockedBuild.mock.calls[0][0] as { entryPoints: Array<{ in: string; out: string }> };
    expect(opts.entryPoints).toHaveLength(1); // only main
  });
});

// ---------------------------------------------------------------------------
// workspace packages (alias + external exclusion)
// ---------------------------------------------------------------------------
describe('runEsbuild — workspace packages', () => {
  it('builds alias map for workspace packages with a resolvable main', async () => {
    const pkgOneDir = path.join(tmpDir, 'packages', 'one');
    await writePkg(tmpDir, {
      name: 'my-monorepo',
      version: '1.0.0',
      main: './dist/module.js',
      workspaces: ['packages/*'],
      dependencies: { '@my/one': '*' },
    });
    await writePkg(pkgOneDir, {
      name: '@my/one',
      version: '1.0.0',
      main: './dist/module.js',
    });
    await writeTs(path.join(tmpDir, 'src', 'module.ts'));
    await writeTs(path.join(pkgOneDir, 'src', 'module.ts'));

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    const opts = mockedBuild.mock.calls[0][0] as { alias: Record<string, string>; external: string[] };
    expect(opts.alias['@my/one']).toContain(path.join('packages', 'one', 'src', 'module.ts'));
    // Local workspace should NOT be in external list
    expect(opts.external).not.toContain('@my/one');
  });

  it('skips workspace packages without a name field', async () => {
    const pkgOneDir = path.join(tmpDir, 'packages', 'nameless');
    await writePkg(tmpDir, {
      name: 'my-monorepo',
      version: '1.0.0',
      main: './dist/module.js',
      workspaces: ['packages/*'],
    });
    await writePkg(pkgOneDir, { version: '1.0.0', main: './dist/module.js' }); // no name
    await writeTs(path.join(tmpDir, 'src', 'module.ts'));

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    const opts = mockedBuild.mock.calls[0][0] as { alias: Record<string, string> };
    expect(Object.keys(opts.alias)).toHaveLength(0);
  });

  it('skips workspace packages without a main or exports field', async () => {
    const pkgOneDir = path.join(tmpDir, 'packages', 'no-main');
    await writePkg(tmpDir, {
      name: 'my-monorepo',
      version: '1.0.0',
      main: './dist/module.js',
      workspaces: ['packages/*'],
    });
    await writePkg(pkgOneDir, { name: '@my/no-main', version: '1.0.0' }); // no main
    await writeTs(path.join(tmpDir, 'src', 'module.ts'));

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    const opts = mockedBuild.mock.calls[0][0] as { alias: Record<string, string> };
    expect(opts.alias['@my/no-main']).toBeUndefined();
  });

  it('resolves workspace main from exports["."]["import"] when "main" is absent', async () => {
    const pkgOneDir = path.join(tmpDir, 'packages', 'exp');
    await writePkg(tmpDir, {
      name: 'my-monorepo',
      version: '1.0.0',
      main: './dist/module.js',
      workspaces: ['packages/*'],
    });
    await writePkg(pkgOneDir, {
      name: '@my/exp',
      version: '1.0.0',
      exports: { '.': { import: './dist/module.js' } },
    });
    await writeTs(path.join(tmpDir, 'src', 'module.ts'));
    await writeTs(path.join(pkgOneDir, 'src', 'module.ts'));

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    const opts = mockedBuild.mock.calls[0][0] as { alias: Record<string, string> };
    expect(opts.alias['@my/exp']).toContain(path.join('packages', 'exp', 'src', 'module.ts'));
  });
});

// ---------------------------------------------------------------------------
// esbuild.build options
// ---------------------------------------------------------------------------
describe('runEsbuild — esbuild.build options', () => {
  it('calls esbuild.build with splitting=true, format=esm, platform=node', async () => {
    await writePkg(tmpDir, { name: 'my-pkg', version: '1.0.0', main: './dist/module.js' });
    await writeTs(path.join(tmpDir, 'src', 'module.ts'));

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    const opts = mockedBuild.mock.calls[0][0] as { splitting: boolean; format: string; platform: string };
    expect(opts.splitting).toBe(true);
    expect(opts.format).toBe('esm');
    expect(opts.platform).toBe('node');
  });

  it('sets outdir to <rootDir>/dist', async () => {
    await writePkg(tmpDir, { name: 'my-pkg', version: '1.0.0', main: './dist/module.js' });
    await writeTs(path.join(tmpDir, 'src', 'module.ts'));

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    const opts = mockedBuild.mock.calls[0][0] as { outdir: string };
    expect(opts.outdir).toBe(path.join(tmpDir, 'dist'));
  });
});
