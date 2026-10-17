/**
 * @file vitest/esbuild.test.ts
 * @description This file contains the tests for the esbuild bundle utilities.
 * @author Luca Liguori
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runEsbuild } from '../src/esbuild.js';
import { initLogger } from '../src/logger.js';

// Mock esbuild so no real bundling happens.
vi.mock('esbuild', () => ({ build: vi.fn().mockResolvedValue({}) }));

vi.mock('../src/dts.js', () => ({
  runDtsBuild: vi.fn().mockImplementation(async () => {}),
  runDtsBundle: vi.fn().mockResolvedValue([]),
}));

import { build as mockBuild, type BuildOptions, type OnResolveArgs, type OnResolveResult, type PluginBuild } from 'esbuild';

const { runDtsBuild, runDtsBundle } = await import('../src/dts.js');

const mockedBuild = vi.mocked(mockBuild);
const mockRunDtsBuild = vi.mocked(runDtsBuild);
const mockRunDtsBundle = vi.mocked(runDtsBundle);

let tmpDir: string;

describe('esbuild', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    initLogger({ dryRun: false, verbose: false, rootDir: '' });
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-esbuild-'));
    mockedBuild.mockClear();
    mockedBuild.mockResolvedValue({ metafile: { inputs: {}, outputs: {} } } as Awaited<ReturnType<typeof mockBuild>>);
    mockRunDtsBuild.mockClear();
    mockRunDtsBuild.mockImplementation(async () => {});
    mockRunDtsBundle.mockClear();
    mockRunDtsBundle.mockResolvedValue([]);
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
  // dryRun and verbose output
  // ---------------------------------------------------------------------------
  describe('runEsbuild — dryRun and verbose output', () => {
    it('returns immediately without calling esbuild.build when dryRun=true', async () => {
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: true });

      expect(mockedBuild).not.toHaveBeenCalled();
      // oxlint-disable-next-line no-console -- verifies dry-run no longer prints options by itself
      expect(vi.mocked(console.log).mock.calls.some(([message]) => String(message).includes('options:'))).toBe(false);
    });

    it('runs declaration build for library packages when dryRun=true', async () => {
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
        automator: { library: true },
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: true });

      expect(mockedBuild).not.toHaveBeenCalled();
      expect(mockRunDtsBuild).toHaveBeenCalledWith({ rootDir: tmpDir, isWindows: false, dryRun: true });
    });

    it('obfuscates every JavaScript output in place, keeping a launcher shebang, when obfuscate=true', async () => {
      await writePkg(tmpDir, { name: 'my-pkg', version: '1.0.0', main: './dist/module.js' });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));
      await mkdir(path.join(tmpDir, 'dist', 'bin'), { recursive: true });
      await writeFile(path.join(tmpDir, 'dist', 'module.js'), "export function greet(name) {\n  return 'Hello, ' + name;\n}\n");
      await writeFile(path.join(tmpDir, 'dist', 'bin', 'cli.js'), "#!/usr/bin/env node\nimport { greet } from '../module.js';\nconsole.log(greet('cli'));\n");
      await writeFile(path.join(tmpDir, 'dist', 'style.css'), 'body { color: red; }\n');
      mockedBuild.mockResolvedValueOnce({
        metafile: { inputs: {}, outputs: { 'dist/module.js': {}, 'dist/bin/cli.js': {}, 'dist/style.css': {} } },
      } as unknown as Awaited<ReturnType<typeof mockBuild>>);

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false, obfuscate: true });

      const moduleCode = await readFile(path.join(tmpDir, 'dist', 'module.js'), 'utf8');
      expect(moduleCode).toMatch(/_0x[0-9a-f]+/);
      expect(moduleCode).toContain('export');
      const cliCode = await readFile(path.join(tmpDir, 'dist', 'bin', 'cli.js'), 'utf8');
      expect(cliCode.startsWith('#!/usr/bin/env node\n')).toBe(true);
      expect(cliCode).toMatch(/_0x[0-9a-f]+/);
      expect(await readFile(path.join(tmpDir, 'dist', 'style.css'), 'utf8')).toBe('body { color: red; }\n');
    });

    it('prints esbuild options when verbose=true and still runs build', async () => {
      initLogger({ dryRun: false, verbose: true, rootDir: tmpDir });
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false, verbose: true });

      expect(mockedBuild).toHaveBeenCalledOnce();
      // oxlint-disable-next-line no-console -- verifies verbose diagnostic output
      expect(vi.mocked(console.log).mock.calls.some(([message]) => String(message).includes('options:'))).toBe(true);
    });
  });

  describe('runEsbuild — declaration build', () => {
    it('runs declaration build and bundle after bundling library packages', async () => {
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
        automator: { library: true },
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));

      await runEsbuild({ rootDir: tmpDir, isWindows: true, dryRun: false });

      expect(mockedBuild).toHaveBeenCalledOnce();
      expect(mockRunDtsBuild).toHaveBeenCalledWith({ rootDir: tmpDir, isWindows: true, dryRun: false });
      expect(mockRunDtsBundle).toHaveBeenCalledWith({ rootDir: tmpDir, dryRun: false });
      expect(mockRunDtsBuild.mock.invocationCallOrder[0]).toBeLessThan(mockRunDtsBundle.mock.invocationCallOrder[0]);
    });

    it('skips declaration build after bundling non-library packages', async () => {
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

      expect(mockRunDtsBuild).not.toHaveBeenCalled();
      expect(mockRunDtsBundle).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // main entry resolution
  // ---------------------------------------------------------------------------
  describe('runEsbuild — main entry resolution', () => {
    it('resolves main entry from the "main" field', async () => {
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

      expect(mockedBuild).toHaveBeenCalledOnce();
      const opts = mockedBuild.mock.calls[0][0] as {
        entryPoints: Array<{ in: string; out: string }>;
      };
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
      const opts = mockedBuild.mock.calls[0][0] as {
        entryPoints: Array<{ in: string; out: string }>;
      };
      expect(opts.entryPoints[0].out).toBe('module');
    });

    it('bundles public export subpaths from string and import targets', async () => {
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
        exports: {
          '.': { import: './dist/module.js' },
          './devices': { import: './dist/devices/export.js' },
          './clusters': './dist/clusters/export.js',
          './types': { types: './dist/types.d.ts' },
          'invalid': { import: './dist/invalid.js' },
          './duplicate': './dist/clusters/export.js',
        },
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));
      await writeTs(path.join(tmpDir, 'src', 'devices', 'export.ts'));
      await writeTs(path.join(tmpDir, 'src', 'clusters', 'export.ts'));

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

      const opts = mockedBuild.mock.calls[0][0] as {
        entryPoints: Array<{ in: string; out: string }>;
      };
      expect(opts.entryPoints).toContainEqual({ in: path.join(tmpDir, 'src', 'devices', 'export.ts'), out: 'devices/export' });
      expect(opts.entryPoints).toContainEqual({ in: path.join(tmpDir, 'src', 'clusters', 'export.ts'), out: 'clusters/export' });
      expect(opts.entryPoints).toHaveLength(3);
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
      expect(opts.external).toContain('bun:*');
    });

    it('adds matterbridge to external when the package is a plugin (scripts.start = matterbridge)', async () => {
      await writePkg(tmpDir, {
        name: 'my-plugin',
        version: '1.0.0',
        main: './dist/module.js',
        scripts: { start: 'matterbridge' },
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

      const opts = mockedBuild.mock.calls[0][0] as { external: string[] };
      expect(opts.external).toContain('matterbridge');
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

      const opts = mockedBuild.mock.calls[0][0] as {
        entryPoints: Array<{ in: string; out: string }>;
      };
      const binEntry = opts.entryPoints.find((e) => e.out === 'bin/cli');
      expect(binEntry).toBeDefined();
      expect(binEntry?.in).toContain(path.join('src', 'bin', 'cli.ts'));
    });

    it('includes an existing JavaScript bin launcher outside dist', async () => {
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
        bin: { 'my-run': 'bin/my-run.js' },
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));
      await mkdir(path.join(tmpDir, 'bin'), { recursive: true });
      await writeFile(path.join(tmpDir, 'bin', 'my-run.js'), 'import "my-pkg";\n');

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

      const opts = mockedBuild.mock.calls[0][0] as {
        entryPoints: Array<{ in: string; out: string }>;
      };
      expect(opts.entryPoints).toContainEqual({ in: path.join(tmpDir, 'bin', 'my-run.js'), out: 'bin/my-run' });
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

      const opts = mockedBuild.mock.calls[0][0] as {
        entryPoints: Array<{ in: string; out: string }>;
      };
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

      const opts = mockedBuild.mock.calls[0][0] as {
        entryPoints: Array<{ in: string; out: string }>;
      };
      expect(opts.entryPoints).toHaveLength(1); // only main
    });

    it('bundles the main entry and its bin launcher together in a single call', async () => {
      // A launcher outside dist commonly imports this package's own compiled output
      // (e.g. `../dist/module.js`) to inline it into a self-contained file. A resolve
      // plugin redirects that import to its TypeScript source (see esbuild.tool.test.ts
      // for a real-build assertion that this avoids duplicating the shared code), so both
      // entries can be bundled together in one call with `splitting: true`.
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
        bin: { 'my-run': 'bin/my-run.js' },
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));
      await mkdir(path.join(tmpDir, 'bin'), { recursive: true });
      await writeFile(path.join(tmpDir, 'bin', 'my-run.js'), 'import "../dist/module.js";\n');

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

      expect(mockedBuild).toHaveBeenCalledOnce();
      const opts = mockedBuild.mock.calls[0][0] as { entryPoints: Array<{ in: string; out: string }> };
      expect(opts.entryPoints).toContainEqual({ in: path.join(tmpDir, 'src', 'module.ts'), out: 'module' });
      expect(opts.entryPoints).toContainEqual({ in: path.join(tmpDir, 'bin', 'my-run.js'), out: 'bin/my-run' });
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

      const opts = mockedBuild.mock.calls[0][0] as {
        alias: Record<string, string>;
        external: string[];
      };
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

      const opts = mockedBuild.mock.calls[0][0] as {
        alias: Record<string, string>;
      };
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

      const opts = mockedBuild.mock.calls[0][0] as {
        alias: Record<string, string>;
      };
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

      const opts = mockedBuild.mock.calls[0][0] as {
        alias: Record<string, string>;
      };
      expect(opts.alias['@my/exp']).toContain(path.join('packages', 'exp', 'src', 'module.ts'));
    });

    it('builds aliases for workspace export subpaths', async () => {
      const pkgOneDir = path.join(tmpDir, 'packages', 'utils');
      await writePkg(tmpDir, {
        name: 'my-monorepo',
        version: '1.0.0',
        main: './dist/module.js',
        workspaces: ['packages/*'],
      });
      await writePkg(pkgOneDir, {
        name: '@my/utils',
        version: '1.0.0',
        main: './dist/export.js',
        exports: {
          '.': { import: './dist/export.js' },
          './loader': { import: './dist/loader.js' },
          './types': { types: './dist/types.d.ts' },
        },
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));
      await writeTs(path.join(pkgOneDir, 'src', 'export.ts'));
      await writeTs(path.join(pkgOneDir, 'src', 'loader.ts'));

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

      const opts = mockedBuild.mock.calls[0][0] as { alias: Record<string, string> };
      expect(opts.alias['@my/utils/loader']).toContain(path.join('packages', 'utils', 'src', 'loader.ts'));
    });
  });

  // ---------------------------------------------------------------------------
  // declared runtime entry points
  // ---------------------------------------------------------------------------
  describe('runEsbuild — automator.esbuild entry points', () => {
    it('bundles declared runtime entry points into their configured output paths', async () => {
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
        automator: { esbuild: { entryPoints: [{ in: 'packages/thread/src/worker.ts', out: 'workers/worker.js' }] } },
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));
      await writeTs(path.join(tmpDir, 'packages', 'thread', 'src', 'worker.ts'));

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

      const opts = mockedBuild.mock.calls[0][0] as { entryPoints: Array<{ in: string; out: string }> };
      expect(opts.entryPoints).toContainEqual({ in: path.join(tmpDir, 'packages', 'thread', 'src', 'worker.ts'), out: 'workers/worker' });
    });

    it('ignores missing or non-object automator configuration', async () => {
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
        automator: [],
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

      const opts = mockedBuild.mock.calls[0][0] as { entryPoints: Array<{ in: string; out: string }> };
      expect(opts.entryPoints).toHaveLength(1);
    });

    it('ignores automator configuration without an esbuild entryPoints array', async () => {
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
        automator: {},
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

      expect(mockedBuild).toHaveBeenCalledOnce();
    });

    it('rejects malformed, escaping, missing, and duplicate entry points', async () => {
      const workerPath = path.join(tmpDir, 'workers', 'worker.ts');
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));
      await writeTs(workerPath);

      const runWithEntries = async (entryPoints: unknown[]): Promise<void> => {
        await writePkg(tmpDir, {
          name: 'my-pkg',
          version: '1.0.0',
          main: './dist/module.js',
          automator: { esbuild: { entryPoints } },
        });
        await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });
      };

      await expect(runWithEntries(['workers/worker.ts'])).rejects.toThrow('expected an object');
      await expect(runWithEntries([{ in: 'workers/worker.ts' }])).rejects.toThrow('non-empty strings');
      await expect(runWithEntries([{ in: '../outside.ts', out: 'workers/worker' }])).rejects.toThrow('paths must stay');
      await expect(runWithEntries([{ in: 'workers/worker.ts', out: '../worker' }])).rejects.toThrow('paths must stay');
      await expect(runWithEntries([{ in: 'workers/missing.ts', out: 'workers/worker' }])).rejects.toThrow('Missing');
      await expect(
        runWithEntries([
          { in: 'workers/worker.ts', out: 'workers/worker' },
          { in: 'workers/worker.ts', out: 'workers/worker' },
        ]),
      ).rejects.toThrow('Duplicate');
    });
  });

  // ---------------------------------------------------------------------------
  // declared external packages
  // ---------------------------------------------------------------------------
  describe('runEsbuild — automator.esbuild external packages', () => {
    it('preserves declared package specifiers as runtime imports', async () => {
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
        automator: { esbuild: { external: ['@jest/globals', 'node:test'] } },
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

      const opts = mockedBuild.mock.calls[0][0] as { external: string[] };
      expect(opts.external).toContain('@jest/globals');
      expect(opts.external).toContain('node:test');
    });

    it('rejects non-array and invalid external package declarations', async () => {
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));

      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
        automator: { esbuild: { external: '@jest/globals' } },
      });
      await expect(runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false })).rejects.toThrow('expected an array');

      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
        automator: { esbuild: { external: [''] } },
      });
      await expect(runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false })).rejects.toThrow('non-empty package specifier');
    });
  });

  // ---------------------------------------------------------------------------
  // declared bundled packages
  // ---------------------------------------------------------------------------
  describe('runEsbuild — automator.esbuild bundled packages', () => {
    it('inlines declared dependencies while external declarations take precedence', async () => {
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
        dependencies: { '@matter/main': '1.0.0', '@jest/globals': '1.0.0' },
        automator: { esbuild: { bundle: ['@matter/main', '@jest/globals'], external: ['@jest/globals'] } },
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

      const opts = mockedBuild.mock.calls[0][0] as { external: string[] };
      expect(opts.external).not.toContain('@matter/main');
      expect(opts.external).toContain('@jest/globals');
    });

    it('keeps every package import external unless it is a workspace package or bundled, and warns about undeclared packages', async () => {
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
        workspaces: ['packages/*'],
        dependencies: { declared: '1.0.0' },
        automator: { esbuild: { bundle: ['inlined', '@inlined/*'], external: ['@explicit/*'] } },
      });
      await writePkg(path.join(tmpDir, 'packages', 'local'), { name: '@my/local', version: '1.0.0', main: './dist/module.js' });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));
      const resolved: Record<string, unknown> = {};
      mockedBuild.mockImplementationOnce((async (options: BuildOptions) => {
        const plugin = options.plugins?.find((candidate) => candidate.name === 'mb-run-external-packages');
        let onResolve: ((args: Pick<OnResolveArgs, 'path' | 'kind'>) => OnResolveResult | undefined) | undefined;
        await plugin?.setup({ onResolve: (_options: unknown, callback: typeof onResolve) => (onResolve = callback) } as unknown as PluginBuild);
        const imports: Array<[string, OnResolveArgs['kind']]> = [
          ['entry', 'entry-point'],
          [path.join(tmpDir, 'src', 'module.ts'), 'import-statement'],
          ['@my/local/sub', 'import-statement'],
          ['inlined/deep', 'import-statement'],
          ['@inlined/pkg', 'import-statement'],
          ['declared/sub', 'import-statement'],
          ['@explicit/thing', 'import-statement'],
          ['node:fs', 'import-statement'],
          ['fs', 'import-statement'],
          ['bun:test', 'dynamic-import'],
          ['undeclared/sub', 'import-statement'],
          ['@undeclared/pkg/deep', 'dynamic-import'],
        ];
        for (const [specifier, kind] of imports) resolved[specifier] = onResolve?.({ path: specifier, kind })?.external ?? 'bundled';
        return { metafile: { inputs: {}, outputs: {} } };
      }) as unknown as typeof mockBuild);

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

      expect(resolved).toEqual({
        'entry': 'bundled',
        [path.join(tmpDir, 'src', 'module.ts')]: 'bundled',
        '@my/local/sub': 'bundled',
        'inlined/deep': 'bundled',
        '@inlined/pkg': 'bundled',
        'declared/sub': true,
        '@explicit/thing': true,
        'node:fs': true,
        'fs': true,
        'bun:test': true,
        'undeclared/sub': true,
        '@undeclared/pkg/deep': true,
      });
      // oxlint-disable-next-line no-console -- verifies the warning output
      const logCalls = vi.mocked(console.log).mock.calls;
      const warnings = logCalls.map(([message]) => String(message)).filter((message) => message.includes('not declared'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('kept external: @undeclared/pkg, undeclared.');
    });

    it('rejects non-array and invalid bundled package declarations', async () => {
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));

      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
        automator: { esbuild: { bundle: '@matter/main' } },
      });
      await expect(runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false })).rejects.toThrow('expected an array');

      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
        automator: { esbuild: { bundle: [''] } },
      });
      await expect(runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false })).rejects.toThrow('non-empty package specifier');
    });
  });

  // ---------------------------------------------------------------------------
  // declared copied entries
  // ---------------------------------------------------------------------------
  describe('runEsbuild — automator.esbuild copied entries', () => {
    it('copies matching compiled files into dist after bundling', async () => {
      const sourceDirectory = path.join(tmpDir, 'packages', 'core', 'dist', 'matter');
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
        automator: { esbuild: { copyEntries: [{ from: 'packages/core/dist/matter', to: 'matter', include: ['**/*.js'] }] } },
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));
      await mkdir(path.join(sourceDirectory, 'nested'), { recursive: true });
      await writeFile(path.join(sourceDirectory, 'export.js'), 'export {};\n');
      await writeFile(path.join(sourceDirectory, 'nested', 'types.js'), 'export {};\n');
      await writeFile(path.join(sourceDirectory, 'ignored.txt'), 'ignored\n');

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

      await expect(readFile(path.join(tmpDir, 'dist', 'matter', 'export.js'), 'utf8')).resolves.toBe('export {};\n');
      await expect(readFile(path.join(tmpDir, 'dist', 'matter', 'nested', 'types.js'), 'utf8')).resolves.toBe('export {};\n');
      await expect(readFile(path.join(tmpDir, 'dist', 'matter', 'ignored.txt'), 'utf8')).rejects.toThrow();
    });

    it('rejects malformed and unsafe copied entry declarations', async () => {
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));
      const runWithCopyEntries = async (copyEntries: unknown): Promise<void> => {
        await writePkg(tmpDir, { name: 'my-pkg', version: '1.0.0', main: './dist/module.js', automator: { esbuild: { copyEntries } } });
        await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });
      };

      await expect(runWithCopyEntries(['packages/core'])).rejects.toThrow('expected an object');
      await expect(runWithCopyEntries([{ from: 'packages/core' }])).rejects.toThrow('from, to, and include');
      await expect(runWithCopyEntries([{ from: '../outside', to: 'matter', include: ['**/*.js'] }])).rejects.toThrow('paths must stay');
      await expect(runWithCopyEntries([{ from: 'missing', to: 'matter', include: ['**/*.js'] }])).rejects.toThrow('source directory must exist');
    });
  });

  // ---------------------------------------------------------------------------
  // esbuild.build options
  // ---------------------------------------------------------------------------
  describe('runEsbuild — esbuild.build options', () => {
    it('applies minify options to the generated bundle', async () => {
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false, minify: true });

      const opts = mockedBuild.mock.calls[0][0] as { legalComments?: string; minify: boolean; minifyWhitespace: boolean };
      expect(opts.minify).toBe(true);
      expect(opts.minifyWhitespace).toBe(true);
      expect(opts.legalComments).toBe('none');
    });

    it('does not minify when the minify option is omitted', async () => {
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

      const opts = mockedBuild.mock.calls[0][0] as { legalComments: string; minify: boolean; minifyWhitespace: boolean };
      expect(opts.minify).toBe(false);
      expect(opts.minifyWhitespace).toBe(false);
      expect(opts.legalComments).toBe('inline');
    });

    it('calls esbuild.build with splitting=true, format=esm, platform=node', async () => {
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

      const opts = mockedBuild.mock.calls[0][0] as {
        splitting: boolean;
        format: string;
        platform: string;
      };
      expect(opts.splitting).toBe(true);
      expect(opts.format).toBe('esm');
      expect(opts.platform).toBe('node');
    });

    it('sets outdir to <rootDir>/dist', async () => {
      await writePkg(tmpDir, {
        name: 'my-pkg',
        version: '1.0.0',
        main: './dist/module.js',
      });
      await writeTs(path.join(tmpDir, 'src', 'module.ts'));

      await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

      const opts = mockedBuild.mock.calls[0][0] as { outdir: string };
      expect(opts.outdir).toBe(path.join(tmpDir, 'dist'));
    });
  });
});
