import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublishOptions } from '../src/publish.js';
import { runPublish } from '../src/publish.js';

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
  runBin: vi.fn().mockResolvedValue(undefined),
  runWorkspaceBuild: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/cache.js', () => ({
  backup: vi.fn().mockResolvedValue(undefined),
  resolveWorkspacePackageJsonPaths: vi.fn().mockResolvedValue([]),
  restore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/clean.js', () => ({
  cleanOnly: vi.fn().mockResolvedValue(undefined),
  emptyDir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/helpers.js', () => ({
  isPlugin: vi.fn().mockResolvedValue(false),
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

const { readFile, rm, writeFile } = await import('node:fs/promises');
const { runBin, runWorkspaceBuild } = await import('../src/build.js');
const { backup, resolveWorkspacePackageJsonPaths, restore } = await import('../src/cache.js');
const { cleanOnly, emptyDir } = await import('../src/clean.js');
const { isPlugin } = await import('../src/helpers.js');
const { runCommand } = await import('../src/spawn.js');
const { updateRootVersion, updateWorkspaceDependencyVersions } = await import('../src/version.js');

const mockReadFile = vi.mocked(readFile);
const mockRm = vi.mocked(rm);
const mockWriteFile = vi.mocked(writeFile);
const mockRunBin = vi.mocked(runBin);
const mockRunWorkspaceBuild = vi.mocked(runWorkspaceBuild);
const mockBackup = vi.mocked(backup);
const mockResolveWorkspacePackageJsonPaths = vi.mocked(resolveWorkspacePackageJsonPaths);
const mockRestore = vi.mocked(restore);
const mockCleanOnly = vi.mocked(cleanOnly);
const mockEmptyDir = vi.mocked(emptyDir);
const mockIsPlugin = vi.mocked(isPlugin);
const mockRunCommand = vi.mocked(runCommand);
const mockUpdateRootVersion = vi.mocked(updateRootVersion);
const mockUpdateWorkspaceDependencyVersions = vi.mocked(updateWorkspaceDependencyVersions);

const rootDir = '/fake/root';

const simplePkg = JSON.stringify({ name: 'my-pkg', version: '1.0.0', devDependencies: { typescript: '^5' }, scripts: { build: 'tsc' } });

function makeOpts(overrides?: Partial<PublishOptions>): PublishOptions {
  return { rootDir, isWindows: false, dryRun: false, ...overrides };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockReadFile.mockResolvedValue(simplePkg as unknown as string);
  mockWriteFile.mockClear();
  mockRm.mockClear();
  mockRunBin.mockResolvedValue(undefined);
  mockRunWorkspaceBuild.mockResolvedValue(undefined);
  mockBackup.mockResolvedValue(undefined);
  mockCleanOnly.mockResolvedValue(undefined);
  mockEmptyDir.mockResolvedValue(undefined);
  mockRestore.mockResolvedValue(undefined);
  mockRunCommand.mockResolvedValue(undefined);
  mockResolveWorkspacePackageJsonPaths.mockResolvedValue([]);
  mockIsPlugin.mockResolvedValue(false);
  mockUpdateRootVersion.mockResolvedValue('1.0.1-dev.0');
  mockUpdateWorkspaceDependencyVersions.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runPublish', () => {
  describe('dryRun: true', () => {
    it('skips backup, restore, readFile, writeFile, and rm', async () => {
      await runPublish(makeOpts({ dryRun: true }));
      expect(mockBackup).not.toHaveBeenCalled();
      expect(mockReadFile).not.toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockRm).not.toHaveBeenCalled();
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

    it('strips devDependencies and scripts from root package.json', async () => {
      await runPublish(makeOpts());
      const written = JSON.parse(mockWriteFile.mock.calls[0]?.[1] as string) as Record<string, unknown>;
      expect(written['devDependencies']).toBeUndefined();
      expect(written['scripts']).toBeUndefined();
    });

    it('calls cleanOnly then runWorkspaceBuild for production and build', async () => {
      await runPublish(makeOpts());
      expect(mockCleanOnly).toHaveBeenCalledWith(expect.objectContaining({ rootDir, dryRun: false }));
      expect(mockRunWorkspaceBuild).toHaveBeenCalledWith(expect.objectContaining({ mode: 'production' }));
      expect(mockRunWorkspaceBuild).toHaveBeenCalledWith(expect.objectContaining({ mode: 'build' }));
    });

    it('empties root node_modules and removes root lock files', async () => {
      await runPublish(makeOpts());
      expect(mockEmptyDir).toHaveBeenCalledWith(expect.stringContaining('node_modules'), expect.anything());
      expect(mockRm).toHaveBeenCalledWith(expect.stringContaining('package-lock.json'), expect.objectContaining({ force: true }));
      expect(mockRm).toHaveBeenCalledWith(expect.stringContaining('npm-shrinkwrap.json'), expect.objectContaining({ force: true }));
    });

    it('calls npm install --omit=dev and npm shrinkwrap --omit=dev', async () => {
      await runPublish(makeOpts());
      expect(mockRunCommand).toHaveBeenCalledWith('npm', expect.arrayContaining(['install', '--omit=dev']), expect.anything());
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

    it('runs npm link matterbridge when isPlugin returns true', async () => {
      mockIsPlugin.mockResolvedValue(true);
      await runPublish(makeOpts());
      expect(mockRunCommand).toHaveBeenCalledWith('npm', expect.arrayContaining(['link', 'matterbridge']), expect.anything());
    });

    it('does not run npm link matterbridge when isPlugin returns false', async () => {
      await runPublish(makeOpts());
      const linkCall = mockRunCommand.mock.calls.find((c) => (c[1] as string[]).includes('link'));
      expect(linkCall).toBeUndefined();
    });

    it('calls runBin prettier in the finally block', async () => {
      await runPublish(makeOpts());
      expect(mockRunBin).toHaveBeenCalledWith('prettier', expect.arrayContaining(['--write', '.']), expect.anything());
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

      it('empties node_modules for root and each workspace', async () => {
        await runPublish(makeOpts());
        // root + ws1 + ws2 = 3 emptyDir calls
        expect(mockEmptyDir).toHaveBeenCalledTimes(3);
      });

      it('publishes each workspace then root (3 publish calls)', async () => {
        await runPublish(makeOpts());
        const publishCalls = mockRunCommand.mock.calls.filter((c) => (c[1] as string[])[0] === 'publish');
        expect(publishCalls).toHaveLength(3);
      });

      it('publishes each workspace and root with --tag when tag is set', async () => {
        await runPublish(makeOpts({ tag: 'dev' }));
        const publishCalls = mockRunCommand.mock.calls.filter((c) => (c[1] as string[])[0] === 'publish');
        expect(publishCalls).toHaveLength(3);
        for (const call of publishCalls) {
          expect(call[1]).toContain('dev');
        }
      });
    });
  });
});
