// oxlint-disable unicorn/no-useless-undefined -- typed vitest mocks require the explicit undefined resolve/return value
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublishOptions } from '../src/publish.js';
import { runPublish } from '../src/publish.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(),
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

vi.mock('../src/format.js', () => ({
  runFormatter: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/helpers.js', () => ({
  isLibrary: vi.fn().mockResolvedValue(false),
  removeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/logger.js', () => ({
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
const { cleanOnly, fileExists } = await import('../src/clean.js');
const { runFormatter } = await import('../src/format.js');
const { isLibrary, removeFile } = await import('../src/helpers.js');
const { runCommand } = await import('../src/spawn.js');
const { updateRootVersion, updateWorkspaceDependencyVersions } = await import('../src/version.js');

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockRunWorkspaceBuild = vi.mocked(runWorkspaceBuild);
const mockRunFormatter = vi.mocked(runFormatter);
const mockBackup = vi.mocked(backup);
const mockResolveWorkspacePackageJsonPaths = vi.mocked(resolveWorkspacePackageJsonPaths);
const mockRestore = vi.mocked(restore);
const mockCleanOnly = vi.mocked(cleanOnly);
const mockFileExists = vi.mocked(fileExists);
const mockIsLibrary = vi.mocked(isLibrary);
const mockRemoveFile = vi.mocked(removeFile);
const mockRunCommand = vi.mocked(runCommand);
const mockUpdateRootVersion = vi.mocked(updateRootVersion);
const mockUpdateWorkspaceDependencyVersions = vi.mocked(updateWorkspaceDependencyVersions);

const rootDir = '/fake/root';

const simplePkg = JSON.stringify({
  name: 'my-pkg',
  version: '1.0.0',
  devDependencies: { typescript: '^5' },
  scripts: { build: 'tsc' },
});

function makeOpts(overrides?: Partial<PublishOptions>): PublishOptions {
  return { rootDir, isWindows: false, dryRun: false, ...overrides };
}

describe('publish', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockReadFile.mockResolvedValue(simplePkg as unknown as string);
    mockReadFile.mockClear();
    mockWriteFile.mockClear();
    mockRunWorkspaceBuild.mockResolvedValue(undefined);
    mockRunFormatter.mockResolvedValue(undefined);
    mockBackup.mockResolvedValue(undefined);
    mockCleanOnly.mockResolvedValue(undefined);
    mockFileExists.mockResolvedValue(false);
    mockIsLibrary.mockResolvedValue(false);
    mockRemoveFile.mockResolvedValue(undefined);
    mockRemoveFile.mockClear();
    mockRestore.mockResolvedValue(undefined);
    mockRunCommand.mockResolvedValue(undefined);
    mockResolveWorkspacePackageJsonPaths.mockResolvedValue([]);
    mockUpdateRootVersion.mockResolvedValue('1.0.1-dev.0');
    mockUpdateWorkspaceDependencyVersions.mockResolvedValue(undefined);
    mockRunCommand.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runPublish', () => {
    describe('dryRun: true', () => {
      it('skips backup, restore, readFile, and writeFile', async () => {
        await runPublish(makeOpts({ dryRun: true }));
        expect(mockBackup).not.toHaveBeenCalled();
        expect(mockReadFile).not.toHaveBeenCalled();
        expect(mockWriteFile).not.toHaveBeenCalled();
        expect(mockRestore).not.toHaveBeenCalled();
      });

      it('still calls runCommand for npm steps', async () => {
        await runPublish(makeOpts({ dryRun: true }));
        expect(mockRunCommand).toHaveBeenCalled();
      });

      it('calls updateRootVersion and updateWorkspaceDependencyVersions when tag is set', async () => {
        await runPublish(makeOpts({ dryRun: true, tag: 'dev' }));
        expect(mockUpdateRootVersion).toHaveBeenCalledWith('dev', expect.objectContaining({ rootDir }));
        expect(mockUpdateWorkspaceDependencyVersions).toHaveBeenCalled();
        expect(mockRunCommand).toHaveBeenCalledWith('npm', expect.arrayContaining(['install', '--package-lock-only']), expect.objectContaining({ dryRun: true }));
      });
    });

    describe('dryRun: false', () => {
      it('calls backup before the pipeline and restore in finally', async () => {
        await runPublish(makeOpts());
        expect(mockBackup).toHaveBeenCalledWith(rootDir);
        expect(mockRestore).toHaveBeenCalledWith(rootDir);
      });

      it('restores the workspace when tagged versioning fails', async () => {
        mockUpdateRootVersion.mockRejectedValueOnce(new Error('version failed'));
        await expect(runPublish(makeOpts({ tag: 'dev' }))).rejects.toThrow('version failed');
        expect(mockRestore).toHaveBeenCalledWith(rootDir);
      });

      it('strips devDependencies and scripts from root package.json', async () => {
        await runPublish(makeOpts());
        const written = JSON.parse(mockWriteFile.mock.calls[0]?.[1] as string) as Record<string, unknown>;
        expect(written['devDependencies']).toBeUndefined();
        expect(written['scripts']).toBeUndefined();
      });

      it('strips workspaces from the temporary root package.json', async () => {
        mockReadFile.mockResolvedValue(
          JSON.stringify({
            ...JSON.parse(simplePkg),
            workspaces: ['packages/*'],
          }) as unknown as string,
        );
        await runPublish(makeOpts());
        const written = JSON.parse(mockWriteFile.mock.calls[0]?.[1] as string) as Record<string, unknown>;
        expect(written['workspaces']).toBeUndefined();
      });

      it('removes type metadata from non-library packages', async () => {
        mockReadFile.mockResolvedValue(
          JSON.stringify({
            ...JSON.parse(simplePkg),
            types: 'dist/module.d.ts',
            exports: { '.': { import: './dist/module.js', types: './dist/module.d.ts' } },
          }) as unknown as string,
        );
        await runPublish(makeOpts());
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
        await runPublish(makeOpts());
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
        await runPublish(makeOpts());
        const written = JSON.parse(mockWriteFile.mock.calls[0]?.[1] as string) as Record<string, unknown>;
        expect(written['types']).toBe('dist/module.d.ts');
        expect((written['exports'] as Record<string, Record<string, unknown>>)['.']['types']).toBe('./dist/module.d.ts');
      });

      it('calls cleanOnly then runWorkspaceBuild for production and build', async () => {
        await runPublish(makeOpts());
        expect(mockCleanOnly).toHaveBeenCalledWith(expect.objectContaining({ rootDir, dryRun: false }));
        expect(mockRunWorkspaceBuild).toHaveBeenCalledWith(expect.objectContaining({ mode: 'production' }));
        expect(mockRunWorkspaceBuild).toHaveBeenCalledWith(expect.objectContaining({ mode: 'build' }));
      });

      it('removes root lock files without emptying node_modules', async () => {
        await runPublish(makeOpts());
        expect(mockRemoveFile).toHaveBeenCalledWith(expect.stringContaining('package-lock.json'), expect.anything());
        expect(mockRemoveFile).toHaveBeenCalledWith(expect.stringContaining('npm-shrinkwrap.json'), expect.anything());
      });

      it('generates a lockfile without installing node_modules', async () => {
        await runPublish(makeOpts());
        expect(mockRunCommand).toHaveBeenCalledWith('npm', expect.arrayContaining(['install', '--package-lock-only', '--omit=dev']), expect.anything());
        expect(mockRunCommand).toHaveBeenCalledWith('npm', expect.arrayContaining(['shrinkwrap', '--omit=dev']), expect.anything());
      });

      it('calls npm publish without --tag when tag is undefined', async () => {
        await runPublish(makeOpts());
        expect(mockRunCommand).toHaveBeenCalledWith('npm', ['publish'], expect.anything());
      });

      it('calls npm publish --tag when tag is set', async () => {
        await runPublish(makeOpts({ tag: 'dev' }));
        expect(mockRunCommand).toHaveBeenCalledWith('npm', ['publish', '--tag', 'dev'], expect.anything());
      });

      it('does not reinstall dependencies after restoring the workspace', async () => {
        await runPublish(makeOpts());
        const fullInstallCall = mockRunCommand.mock.calls.find((call) => call[1][0] === 'install' && !call[1].includes('--package-lock-only'));
        expect(fullInstallCall).toBeUndefined();
      });

      it('restores original root and workspace lockfiles after publishing', async () => {
        const workspacePkgPath = path.join(rootDir, 'packages', 'workspace', 'package.json');
        const rootPackageLock = Buffer.from('root package lock');
        const rootShrinkwrap = Buffer.from('root shrinkwrap');
        const workspacePackageLock = Buffer.from('workspace package lock');
        const workspaceShrinkwrap = Buffer.from('workspace shrinkwrap');
        mockResolveWorkspacePackageJsonPaths.mockResolvedValue([workspacePkgPath]);
        mockFileExists.mockResolvedValue(true);
        mockReadFile
          .mockResolvedValueOnce(rootPackageLock as never)
          .mockResolvedValueOnce(rootShrinkwrap as never)
          .mockResolvedValueOnce(workspacePackageLock as never)
          .mockResolvedValueOnce(workspaceShrinkwrap as never)
          .mockResolvedValue(simplePkg as unknown as string);
        await runPublish(makeOpts());
        const workspaceDir = path.dirname(workspacePkgPath);
        expect(mockWriteFile).toHaveBeenCalledWith(path.join(rootDir, 'package-lock.json'), rootPackageLock);
        expect(mockWriteFile).toHaveBeenCalledWith(path.join(rootDir, 'npm-shrinkwrap.json'), rootShrinkwrap);
        expect(mockWriteFile).toHaveBeenCalledWith(path.join(workspaceDir, 'package-lock.json'), workspacePackageLock);
        expect(mockWriteFile).toHaveBeenCalledWith(path.join(workspaceDir, 'npm-shrinkwrap.json'), workspaceShrinkwrap);
      });

      it('formats through the configured formatter before the final build', async () => {
        await runPublish(makeOpts());
        expect(mockRunFormatter).toHaveBeenCalledWith({ ...makeOpts(), check: false });
        const formatterCallOrder = mockRunFormatter.mock.invocationCallOrder[0];
        const finalBuildCallOrder = mockRunWorkspaceBuild.mock.invocationCallOrder.at(-1);
        expect(formatterCallOrder).toBeLessThan(finalBuildCallOrder ?? 0);
      });

      it('restores in the finally block even when an error is thrown mid-pipeline', async () => {
        mockRunWorkspaceBuild.mockRejectedValueOnce(new Error('build failed'));
        await expect(runPublish(makeOpts())).rejects.toThrow('build failed');
        expect(mockRestore).toHaveBeenCalledWith(rootDir);
      });

      describe('with workspace packages', () => {
        const ws1 = `${rootDir}/packages/ws-one/package.json`;
        const ws2 = `${rootDir}/packages/ws-two/package.json`;

        beforeEach(() => {
          mockResolveWorkspacePackageJsonPaths.mockResolvedValue([ws1, ws2]);
        });

        it('strips devDependencies and scripts from each workspace package.json', async () => {
          await runPublish(makeOpts());
          // root + ws1 + ws2 = 3 writeFile calls for stripping
          expect(mockWriteFile).toHaveBeenCalledTimes(3);
          for (const call of mockWriteFile.mock.calls) {
            const written = JSON.parse(call[1] as string) as Record<string, unknown>;
            expect(written['devDependencies']).toBeUndefined();
            expect(written['scripts']).toBeUndefined();
          }
        });

        it('removes lockfiles for root and each workspace', async () => {
          await runPublish(makeOpts());
          // root + ws1 + ws2 = 6 lockfile paths
          expect(mockRemoveFile).toHaveBeenCalledTimes(12);
        });

        it('publishes each workspace then root (3 publish calls)', async () => {
          await runPublish(makeOpts());
          const publishCalls = mockRunCommand.mock.calls.filter((c) => c[1][0] === 'publish');
          expect(publishCalls).toHaveLength(3);
        });

        it('publishes each workspace and root with --tag when tag is set', async () => {
          await runPublish(makeOpts({ tag: 'dev' }));
          const publishCalls = mockRunCommand.mock.calls.filter((c) => c[1][0] === 'publish');
          expect(publishCalls).toHaveLength(3);
          for (const call of publishCalls) {
            expect(call[1]).toContain('dev');
          }
        });
      });
    });
  });
});
