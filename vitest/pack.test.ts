// oxlint-disable unicorn/no-useless-undefined -- typed vitest mocks require the explicit undefined resolve/return value
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PackOptions } from '../src/pack.js';
import { runPack } from '../src/pack.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(),
    rm: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../src/build.js', () => ({
  runWorkspaceBuild: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/cache.js', () => ({
  backup: vi.fn().mockResolvedValue(undefined),
  resolveWorkspacePackageJsonPaths: vi.fn().mockResolvedValue([]),
  restore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/clean.js', () => ({
  cleanOnly: vi.fn().mockResolvedValue(undefined),
  fileExists: vi.fn().mockResolvedValue(false),
}));

vi.mock('../src/esbuild.js', () => ({
  runEsbuild: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/dts.js', () => ({
  runDtsBundle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/format.js', () => ({
  runFormatter: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/helpers.js', () => ({
  isLibrary: vi.fn().mockResolvedValue(false),
  removeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/logger.js', () => ({
  logDelete: vi.fn(),
  logWriteFile: vi.fn(),
}));

vi.mock('../src/spawn.js', () => ({
  runCommand: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/version.js', () => ({
  updateRootVersion: vi.fn().mockResolvedValue('1.0.1-dev.0'),
  updateWorkspaceDependencyVersions: vi.fn().mockResolvedValue(undefined),
}));

const { readFile, writeFile } = await import('node:fs/promises');
const { runWorkspaceBuild } = await import('../src/build.js');
const { backup, resolveWorkspacePackageJsonPaths, restore } = await import('../src/cache.js');
const { fileExists } = await import('../src/clean.js');
const { runEsbuild } = await import('../src/esbuild.js');
const { runDtsBundle } = await import('../src/dts.js');
const { runFormatter } = await import('../src/format.js');
const { isLibrary } = await import('../src/helpers.js');
const { runCommand } = await import('../src/spawn.js');
const { updateRootVersion } = await import('../src/version.js');

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockRunWorkspaceBuild = vi.mocked(runWorkspaceBuild);
const mockRunEsbuild = vi.mocked(runEsbuild);
const mockRunDtsBundle = vi.mocked(runDtsBundle);
const mockRunFormatter = vi.mocked(runFormatter);
const mockBackup = vi.mocked(backup);
const mockResolveWorkspacePackageJsonPaths = vi.mocked(resolveWorkspacePackageJsonPaths);
const mockRestore = vi.mocked(restore);
const mockFileExists = vi.mocked(fileExists);
const mockIsLibrary = vi.mocked(isLibrary);
const mockRunCommand = vi.mocked(runCommand);
const mockUpdateRootVersion = vi.mocked(updateRootVersion);

const rootDir = '/fake/root';

const simplePkg = JSON.stringify({
  name: 'my-pkg',
  version: '1.0.0',
  devDependencies: { typescript: '^5' },
  scripts: { build: 'tsc' },
});

function makeOpts(overrides?: Partial<PackOptions>): PackOptions {
  return { rootDir, isWindows: false, dryRun: false, ...overrides };
}

describe('pack', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockReadFile.mockResolvedValue(simplePkg as unknown as string);
    mockReadFile.mockClear();
    mockWriteFile.mockClear();
    mockRunCommand.mockClear();
    mockRunEsbuild.mockClear();
    mockRunDtsBundle.mockClear();
    mockBackup.mockClear();
    mockRestore.mockClear();
    mockRunCommand.mockResolvedValue(undefined);
    mockRunWorkspaceBuild.mockResolvedValue(undefined);
    mockRunFormatter.mockResolvedValue(undefined);
    mockResolveWorkspacePackageJsonPaths.mockResolvedValue([]);
    mockFileExists.mockResolvedValue(false);
    mockIsLibrary.mockResolvedValue(false);
    mockUpdateRootVersion.mockResolvedValue('1.0.1-dev.0');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runPack', () => {
    describe('dryRun: true', () => {
      it('skips backup, restore, and file I/O', async () => {
        await runPack(makeOpts({ dryRun: true }));
        expect(mockBackup).not.toHaveBeenCalled();
        expect(mockReadFile).not.toHaveBeenCalled();
        expect(mockWriteFile).not.toHaveBeenCalled();
        expect(mockRestore).not.toHaveBeenCalled();
      });

      it('still calls runCommand for npm steps', async () => {
        await runPack(makeOpts({ dryRun: true }));
        expect(mockRunCommand).toHaveBeenCalled();
      });

      it('generates the production lockfile without installing node_modules', async () => {
        await runPack(makeOpts({ dryRun: true }));
        expect(mockRunCommand).toHaveBeenCalledWith(
          'npm',
          ['install', '--package-lock-only', '--omit=dev', '--no-fund', '--no-audit', '--silent'],
          expect.objectContaining({ cwd: rootDir, dryRun: true }),
        );
      });

      it('does not minify the bundle by default', async () => {
        await runPack(makeOpts({ dryRun: true }));
        expect(mockRunEsbuild).toHaveBeenCalledWith({ ...makeOpts({ dryRun: true }), minify: undefined, verbose: undefined });
      });

      it('minifies the bundle when requested', async () => {
        await runPack(makeOpts({ dryRun: true, minify: true }));
        expect(mockRunEsbuild).toHaveBeenCalledWith({ ...makeOpts({ dryRun: true, minify: true }), verbose: undefined });
      });

      it('bundles declarations for library packages', async () => {
        mockIsLibrary.mockResolvedValue(true);

        await runPack(makeOpts({ dryRun: true }));

        expect(mockRunDtsBundle).toHaveBeenCalledWith({ rootDir, dryRun: true });
      });

      it('calls updateRootVersion and queues install --package-lock-only when tag is set', async () => {
        await runPack(makeOpts({ dryRun: true, tag: 'dev' }));
        expect(mockUpdateRootVersion).toHaveBeenCalledWith('dev', expect.objectContaining({ rootDir }));
        expect(mockRunCommand).toHaveBeenCalledWith('npm', expect.arrayContaining(['install', '--package-lock-only']), expect.objectContaining({ dryRun: true }));
      });
    });

    describe('dryRun: false', () => {
      it('backs up before the pipeline and restores in finally', async () => {
        await runPack(makeOpts());
        expect(mockBackup).toHaveBeenCalledWith(rootDir);
        expect(mockRestore).toHaveBeenCalledWith(rootDir);
      });

      it('restores the workspace when tagged versioning fails', async () => {
        mockUpdateRootVersion.mockRejectedValueOnce(new Error('version failed'));
        await expect(runPack(makeOpts({ tag: 'dev' }))).rejects.toThrow('version failed');
        expect(mockRestore).toHaveBeenCalledWith(rootDir);
      });

      it('formats with the configured formatter selector', async () => {
        await runPack(makeOpts());
        expect(mockRunFormatter).toHaveBeenCalledWith({ ...makeOpts(), check: false });
      });

      it('strips devDependencies and scripts from package.json', async () => {
        await runPack(makeOpts());
        const written = JSON.parse(mockWriteFile.mock.calls[0]?.[1] as string) as Record<string, unknown>;
        expect(written['devDependencies']).toBeUndefined();
        expect(written['scripts']).toBeUndefined();
      });

      it('does not add workspace dist folders to the files field', async () => {
        const ws1 = path.join(rootDir, 'packages', 'ws-one', 'package.json');
        const ws2 = path.join(rootDir, 'packages', 'ws-two', 'package.json');
        const rootPkg = JSON.stringify({
          name: 'root',
          version: '1.0.0',
          files: ['dist', 'packages/ws-one/dist'],
          devDependencies: {},
          scripts: {},
          workspaces: ['packages/*'],
        });
        const ws1Pkg = JSON.stringify({ name: 'ws-one' });
        const ws2Pkg = JSON.stringify({ name: 'ws-two' });
        mockResolveWorkspacePackageJsonPaths.mockResolvedValue([ws1, ws2]);
        mockReadFile
          .mockResolvedValueOnce(rootPkg as unknown as string)
          .mockResolvedValueOnce(rootPkg as unknown as string)
          .mockResolvedValueOnce(ws1Pkg as unknown as string)
          .mockResolvedValueOnce(ws2Pkg as unknown as string)
          .mockResolvedValueOnce(ws1Pkg as unknown as string)
          .mockResolvedValueOnce(ws2Pkg as unknown as string);

        await runPack(makeOpts());

        const written = JSON.parse(mockWriteFile.mock.calls[0]?.[1] as string) as { files?: string[] };
        expect(written.files).toEqual(['dist', 'packages/ws-one/dist']);
      });

      it('redirects a bundled JavaScript launcher to dist', async () => {
        mockFileExists.mockImplementation(async (filePath) => filePath === path.join(rootDir, 'bin', 'my-cli.js'));
        mockReadFile.mockResolvedValue(
          JSON.stringify({
            ...JSON.parse(simplePkg),
            bin: { 'my-cli': 'bin/my-cli.js' },
          }) as unknown as string,
        );

        await runPack(makeOpts());

        const written = JSON.parse(mockWriteFile.mock.calls[0]?.[1] as string) as { bin?: Record<string, string> };
        expect(written.bin).toEqual({ 'my-cli': 'dist/bin/my-cli.js' });
      });

      it('leaves bundled and missing binary launchers unchanged', async () => {
        mockReadFile.mockResolvedValue(
          JSON.stringify({
            ...JSON.parse(simplePkg),
            bin: {
              bundled: 'dist/bin/bundled.js',
              missing: 'bin/missing.js',
            },
          }) as unknown as string,
        );

        await runPack(makeOpts());

        const written = JSON.parse(mockWriteFile.mock.calls[0]?.[1] as string) as { bin?: Record<string, string> };
        expect(written.bin).toEqual({
          bundled: 'dist/bin/bundled.js',
          missing: 'bin/missing.js',
        });
      });

      it('removes type metadata from non-library packages', async () => {
        mockReadFile.mockResolvedValue(
          JSON.stringify({
            ...JSON.parse(simplePkg),
            types: 'dist/module.d.ts',
            exports: { '.': { import: './dist/module.js', types: './dist/module.d.ts' } },
          }) as unknown as string,
        );
        await runPack(makeOpts());
        const written = JSON.parse(mockWriteFile.mock.calls[0]?.[1] as string) as Record<string, unknown>;
        expect(written['types']).toBeUndefined();
        expect((written['exports'] as Record<string, Record<string, unknown>>)['.']['types']).toBeUndefined();
      });

      it('preserves a string-form root export for non-library packages', async () => {
        mockReadFile.mockResolvedValue(
          JSON.stringify({
            ...JSON.parse(simplePkg),
            types: 'dist/module.d.ts',
            exports: { '.': './dist/module.js' },
          }) as unknown as string,
        );
        await runPack(makeOpts());
        const written = JSON.parse(mockWriteFile.mock.calls[0]?.[1] as string) as Record<string, unknown>;
        expect(written['types']).toBeUndefined();
        expect(written['exports']).toEqual({ '.': './dist/module.js' });
      });

      it('retains type metadata for library packages', async () => {
        mockIsLibrary.mockResolvedValue(true);
        mockReadFile.mockResolvedValue(
          JSON.stringify({
            ...JSON.parse(simplePkg),
            types: 'dist/module.d.ts',
            exports: { '.': { import: './dist/module.js', types: './dist/module.d.ts' } },
          }) as unknown as string,
        );
        await runPack(makeOpts());
        const written = JSON.parse(mockWriteFile.mock.calls[0]?.[1] as string) as Record<string, unknown>;
        expect(written['types']).toBe('dist/module.d.ts');
        expect((written['exports'] as Record<string, Record<string, unknown>>)['.']['types']).toBe('./dist/module.d.ts');
      });

      it('does not reinstall dependencies after restoring the workspace', async () => {
        await runPack(makeOpts());
        const fullInstallCall = mockRunCommand.mock.calls.find((call) => call[1][0] === 'install' && !call[1].includes('--package-lock-only'));
        expect(fullInstallCall).toBeUndefined();
      });

      it('restores the original lockfiles after packing', async () => {
        const packageLock = Buffer.from('original package lock');
        const shrinkwrap = Buffer.from('original shrinkwrap');
        mockFileExists.mockResolvedValue(true);
        mockReadFile
          .mockResolvedValueOnce(packageLock as never)
          .mockResolvedValueOnce(shrinkwrap as never)
          .mockResolvedValue(simplePkg as unknown as string);
        await runPack(makeOpts());
        expect(mockWriteFile).toHaveBeenCalledWith(path.join(rootDir, 'package-lock.json'), packageLock);
        expect(mockWriteFile).toHaveBeenCalledWith(path.join(rootDir, 'npm-shrinkwrap.json'), shrinkwrap);
      });

      it('restores in the finally block even when an error is thrown mid-pipeline', async () => {
        mockRunWorkspaceBuild.mockRejectedValueOnce(new Error('build failed'));
        await expect(runPack(makeOpts())).rejects.toThrow('build failed');
        expect(mockRestore).toHaveBeenCalledWith(rootDir);
      });

      describe('workspace dependency merging', () => {
        const ws1 = `${rootDir}/packages/ws-one/package.json`;
        const ws2 = `${rootDir}/packages/ws-two/package.json`;

        // root has `existing` dep; ws1 adds `uuid` (new) and shares `existing` (dup); ws2 adds `chalk` (new) but has no `name`
        const rootPkg = JSON.stringify({
          name: 'root',
          version: '1.0.0',
          dependencies: { existing: '^1.0.0' },
          devDependencies: {},
          scripts: {},
          workspaces: ['packages/*'],
        });
        const rootPkgStripped = JSON.stringify({
          name: 'root',
          version: '1.0.0',
          dependencies: { existing: '^1.0.0' },
          workspaces: ['packages/*'],
        });
        const ws1Pkg = JSON.stringify({
          name: 'ws-one',
          dependencies: { existing: '^1.0.0', uuid: '^9.0.0' },
        });
        const ws2Pkg = JSON.stringify({ dependencies: { chalk: '^5.0.0' } }); // no name — covers falsy wNamePkg.name branch

        beforeEach(() => {
          mockResolveWorkspacePackageJsonPaths.mockResolvedValue([ws1, ws2]);
          mockReadFile
            .mockResolvedValueOnce(rootPkg as unknown as string) // step 4: strip devDeps/scripts
            .mockResolvedValueOnce(rootPkgStripped as unknown as string) // step 4b: root for merging
            .mockResolvedValueOnce(ws1Pkg as unknown as string) // dep loop: ws1
            .mockResolvedValueOnce(ws2Pkg as unknown as string) // dep loop: ws2
            .mockResolvedValueOnce(ws1Pkg as unknown as string) // name loop: ws1
            .mockResolvedValueOnce(ws2Pkg as unknown as string); // name loop: ws2
        });

        it('adds new workspace deps to root dependencies', async () => {
          await runPack(makeOpts());
          const deps = (JSON.parse(mockWriteFile.mock.calls[1]?.[1] as string) as Record<string, unknown>)['dependencies'] as Record<string, string>;
          expect(deps['uuid']).toBe('^9.0.0');
          expect(deps['chalk']).toBe('^5.0.0');
        });

        it('does not override a dep already present in root', async () => {
          await runPack(makeOpts());
          const deps = (JSON.parse(mockWriteFile.mock.calls[1]?.[1] as string) as Record<string, unknown>)['dependencies'] as Record<string, string>;
          expect(deps['existing']).toBe('^1.0.0'); // kept from root, not overridden by ws1's identical version
        });

        it('removes the workspace package name from root dependencies', async () => {
          await runPack(makeOpts());
          const deps = (JSON.parse(mockWriteFile.mock.calls[1]?.[1] as string) as Record<string, unknown>)['dependencies'] as Record<string, string>;
          expect(deps['ws-one']).toBeUndefined();
        });

        it('strips the workspaces field from the root package.json', async () => {
          await runPack(makeOpts());
          const merged = JSON.parse(mockWriteFile.mock.calls[1]?.[1] as string) as Record<string, unknown>;
          expect(merged['workspaces']).toBeUndefined();
        });

        it('handles root with no dependencies field and workspace with no dependencies field', async () => {
          // Covers the `pkg['dependencies'] ?? {}` and `wPkg.dependencies ?? {}` null-coalescing branches
          const rootNoDeps = JSON.stringify({
            name: 'root',
            version: '1.0.0',
            devDependencies: {},
            scripts: {},
          });
          const wsNoDeps = JSON.stringify({}); // no name, no dependencies
          mockReadFile.mockReset();
          mockReadFile
            .mockResolvedValueOnce(rootNoDeps as unknown as string) // step 4: strip
            .mockResolvedValueOnce(rootNoDeps as unknown as string) // step 4b: root (no deps field)
            .mockResolvedValueOnce(wsNoDeps as unknown as string) // dep loop: ws1
            .mockResolvedValueOnce(wsNoDeps as unknown as string) // dep loop: ws2
            .mockResolvedValueOnce(wsNoDeps as unknown as string) // name loop: ws1
            .mockResolvedValueOnce(wsNoDeps as unknown as string); // name loop: ws2
          await runPack(makeOpts());
          const merged = JSON.parse(mockWriteFile.mock.calls[1]?.[1] as string) as Record<string, unknown>;
          expect(merged['dependencies']).toEqual({});
        });
      });
    });
  });
});
