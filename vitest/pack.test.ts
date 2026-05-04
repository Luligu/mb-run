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

vi.mock('../src/esbuild.js', () => ({
  runEsbuild: vi.fn().mockResolvedValue(undefined),
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

const { readFile, writeFile } = await import('node:fs/promises');
const { runWorkspaceBuild } = await import('../src/build.js');
const { backup, resolveWorkspacePackageJsonPaths, restore } = await import('../src/cache.js');
const { isPlugin } = await import('../src/helpers.js');
const { runCommand } = await import('../src/spawn.js');
const { updateRootVersion } = await import('../src/version.js');

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockRunWorkspaceBuild = vi.mocked(runWorkspaceBuild);
const mockBackup = vi.mocked(backup);
const mockResolveWorkspacePackageJsonPaths = vi.mocked(resolveWorkspacePackageJsonPaths);
const mockRestore = vi.mocked(restore);
const mockIsPlugin = vi.mocked(isPlugin);
const mockRunCommand = vi.mocked(runCommand);
const mockUpdateRootVersion = vi.mocked(updateRootVersion);

const rootDir = '/fake/root';

const simplePkg = JSON.stringify({ name: 'my-pkg', version: '1.0.0', devDependencies: { typescript: '^5' }, scripts: { build: 'tsc' } });

function makeOpts(overrides?: Partial<PackOptions>): PackOptions {
  return { rootDir, isWindows: false, dryRun: false, ...overrides };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockReadFile.mockResolvedValue(simplePkg as unknown as string);
  mockWriteFile.mockClear();
  mockRunCommand.mockResolvedValue(undefined);
  mockRunWorkspaceBuild.mockResolvedValue(undefined);
  mockResolveWorkspacePackageJsonPaths.mockResolvedValue([]);
  mockIsPlugin.mockResolvedValue(false);
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

    it('strips devDependencies and scripts from package.json', async () => {
      await runPack(makeOpts());
      const written = JSON.parse(mockWriteFile.mock.calls[0]?.[1] as string) as Record<string, unknown>;
      expect(written['devDependencies']).toBeUndefined();
      expect(written['scripts']).toBeUndefined();
    });

    it('runs npm link matterbridge when isPlugin returns true', async () => {
      mockIsPlugin.mockResolvedValue(true);
      await runPack(makeOpts());
      expect(mockRunCommand).toHaveBeenCalledWith('npm', expect.arrayContaining(['link', 'matterbridge']), expect.anything());
    });

    it('does not run npm link matterbridge when isPlugin returns false', async () => {
      await runPack(makeOpts());
      const linkCall = mockRunCommand.mock.calls.find((c) => (c[1] as string[]).includes('link'));
      expect(linkCall).toBeUndefined();
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
      const rootPkg = JSON.stringify({ name: 'root', version: '1.0.0', dependencies: { existing: '^1.0.0' }, devDependencies: {}, scripts: {}, workspaces: ['packages/*'] });
      const rootPkgStripped = JSON.stringify({ name: 'root', version: '1.0.0', dependencies: { existing: '^1.0.0' }, workspaces: ['packages/*'] });
      const ws1Pkg = JSON.stringify({ name: 'ws-one', dependencies: { existing: '^1.0.0', uuid: '^9.0.0' } });
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
        const rootNoDeps = JSON.stringify({ name: 'root', version: '1.0.0', devDependencies: {}, scripts: {} });
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
