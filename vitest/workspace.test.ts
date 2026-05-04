import { EventEmitter } from 'node:events';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { ExitError, main } from '../src/module.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock('cross-spawn', () => ({
  default: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    access: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(actual.readFile as (...args: unknown[]) => unknown),
    readdir: vi.fn(actual.readdir as (...args: unknown[]) => unknown),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../src/clean.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/clean.js')>();
  return {
    ...actual,
    fileExists: vi.fn(actual.fileExists),
  };
});

const { spawn, execFileSync } = await import('node:child_process');
const { default: crossSpawn } = await import('cross-spawn');
const { readFile, readdir } = await import('node:fs/promises');
const { fileExists } = await import('../src/clean.js');

const mockSpawn = vi.mocked(spawn);
const mockCrossSpawn = vi.mocked(crossSpawn);
const mockExecFileSync = vi.mocked(execFileSync);
const mockReadFile = readFile as unknown as Mock;
const mockReaddir = readdir as unknown as Mock;
const mockFileExists = vi.mocked(fileExists);

const repoRoot = path.join(process.cwd(), 'vendor', 'tool');
const rootPkgPath = path.join(repoRoot, 'package.json');

function makeChild(exitCode: number): EventEmitter {
  const child = new EventEmitter();
  setImmediate(() => child.emit('exit', exitCode));
  return child;
}

function setArgs(...args: string[]): void {
  process.argv = ['node', 'mb-run', ...args];
}

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'cwd').mockReturnValue(repoRoot);

  mockExecFileSync.mockReturnValue('abc1234\n');
  mockSpawn.mockImplementation(() => makeChild(0) as ReturnType<typeof spawn>);
  mockCrossSpawn.mockImplementation(() => makeChild(0) as ReturnType<typeof crossSpawn>);

  const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

  mockReadFile.mockImplementation(actualFs.readFile);

  mockReaddir.mockImplementation(actualFs.readdir);

  const actualClean = await vi.importActual<typeof import('../src/clean.js')>('../src/clean.js');
  mockFileExists.mockImplementation(actualClean.fileExists);
});

describe('main — no package.json in cwd', () => {
  it('throws ExitError when package.json is absent', async () => {
    mockFileExists.mockResolvedValue(false);
    setArgs('--dry-run', '--build');
    await expect(main()).rejects.toBeInstanceOf(ExitError);
  });

  it('ExitError message mentions package.json', async () => {
    mockFileExists.mockResolvedValue(false);
    setArgs('--dry-run', '--build');
    await expect(main()).rejects.toMatchObject({ message: expect.stringContaining('package.json') });
  });
});

describe('main — extractBaseSemver error', () => {
  it('throws ExitError when package.json version is not a valid semver', async () => {
    mockReadFile.mockImplementation(async (p: unknown) => {
      if (p === rootPkgPath) return JSON.stringify({ name: 'root', version: 'not-valid' });
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readFile(p as string, 'utf8');
    });
    mockFileExists.mockImplementation(async (p: string) => {
      if (p === rootPkgPath) return true;
      const actual = await vi.importActual<typeof import('../src/clean.js')>('../src/clean.js');
      return actual.fileExists(p);
    });
    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).rejects.toBeInstanceOf(ExitError);
  });
});

describe('main — getShortSha7 error', () => {
  it('throws ExitError when git rev-parse fails', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('git not found');
    });
    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).rejects.toBeInstanceOf(ExitError);
  });

  it('throws when git outputs unexpected SHA format', async () => {
    mockExecFileSync.mockReturnValue('XXXXXXXX\n');
    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).rejects.toThrow();
  });
});

describe('main — workspace explicit paths', () => {
  it('resolves cleanly with a single explicit workspace', async () => {
    const ws1PkgPath = path.join(repoRoot, 'packages', 'ws1', 'package.json');
    const rootPkg = JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/ws1'] });
    const ws1Pkg = JSON.stringify({ name: 'ws1', version: '1.0.0' });

    mockReadFile.mockImplementation(async (p: unknown) => {
      if (p === rootPkgPath) return rootPkg;
      if (p === ws1PkgPath) return ws1Pkg;
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readFile(p as string, 'utf8');
    });
    mockFileExists.mockImplementation(async (p: string) => {
      if (p === rootPkgPath) return true;
      if (p === ws1PkgPath) return true;
      const actual = await vi.importActual<typeof import('../src/clean.js')>('../src/clean.js');
      return actual.fileExists(p);
    });

    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).resolves.toBeUndefined();
  });

  it('skips explicit workspace path when package.json does not exist', async () => {
    const rootPkg = JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/missing'] });

    mockReadFile.mockImplementation(async (p: unknown) => {
      if (p === rootPkgPath) return rootPkg;
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readFile(p as string, 'utf8');
    });
    mockFileExists.mockImplementation(async (p: string) => {
      if (p === rootPkgPath) return true;
      return false;
    });

    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).resolves.toBeUndefined();
  });

  it('throws ExitError when workspace package.json is missing name field', async () => {
    const ws1PkgPath = path.join(repoRoot, 'packages', 'ws1', 'package.json');
    const rootPkg = JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/ws1'] });
    const ws1Pkg = JSON.stringify({ version: '1.0.0' });

    mockReadFile.mockImplementation(async (p: unknown) => {
      if (p === rootPkgPath) return rootPkg;
      if (p === ws1PkgPath) return ws1Pkg;
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readFile(p as string, 'utf8');
    });
    mockFileExists.mockImplementation(async (p: string) => {
      if (p === rootPkgPath) return true;
      if (p === ws1PkgPath) return true;
      return false;
    });

    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).rejects.toBeInstanceOf(ExitError);
  });

  it('updates cross-workspace dependency versions in dry-run (covers logWriteFile)', async () => {
    const ws1PkgPath = path.join(repoRoot, 'packages', 'ws1', 'package.json');
    const ws2PkgPath = path.join(repoRoot, 'packages', 'ws2', 'package.json');
    const rootPkg = JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/ws1', 'packages/ws2'] });
    const ws1Pkg = JSON.stringify({ name: 'ws1', version: '1.0.0' });
    const ws2Pkg = JSON.stringify({ name: 'ws2', version: '1.0.0', dependencies: { ws1: '1.0.0' } });

    mockReadFile.mockImplementation(async (p: unknown) => {
      if (p === rootPkgPath) return rootPkg;
      if (p === ws1PkgPath) return ws1Pkg;
      if (p === ws2PkgPath) return ws2Pkg;
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readFile(p as string, 'utf8');
    });
    mockFileExists.mockImplementation(async (p: string) => {
      if (p === rootPkgPath) return true;
      if (p === ws1PkgPath) return true;
      if (p === ws2PkgPath) return true;
      return false;
    });

    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).resolves.toBeUndefined();
  });
});

describe('main — workspace object format', () => {
  it('handles { packages: [...] } format', async () => {
    const ws1PkgPath = path.join(repoRoot, 'packages', 'ws1', 'package.json');
    const rootPkg = JSON.stringify({ name: 'root', version: '1.0.0', workspaces: { packages: ['packages/ws1'] } });
    const ws1Pkg = JSON.stringify({ name: 'ws1', version: '1.0.0' });

    mockReadFile.mockImplementation(async (p: unknown) => {
      if (p === rootPkgPath) return rootPkg;
      if (p === ws1PkgPath) return ws1Pkg;
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readFile(p as string, 'utf8');
    });
    mockFileExists.mockImplementation(async (p: string) => {
      if (p === rootPkgPath) return true;
      if (p === ws1PkgPath) return true;
      return false;
    });

    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).resolves.toBeUndefined();
  });
});

describe('main — workspace glob patterns', () => {
  it('resolves with packages/* when directory exists', async () => {
    const packagesDir = path.join(repoRoot, 'packages');
    const ws1PkgPath = path.join(packagesDir, 'ws1', 'package.json');
    const rootPkg = JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/*'] });
    const ws1Pkg = JSON.stringify({ name: 'ws1', version: '1.0.0' });

    mockReadFile.mockImplementation(async (p: unknown) => {
      if (p === rootPkgPath) return rootPkg;
      if (p === ws1PkgPath) return ws1Pkg;
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readFile(p as string, 'utf8');
    });

    const fakeDirent = { name: 'ws1', isDirectory: () => true } as unknown as Dirent;
    mockReaddir.mockImplementation(async (p: unknown) => {
      if (p === packagesDir) return [fakeDirent] as Dirent[];
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readdir(p as string, { withFileTypes: true });
    });

    mockFileExists.mockImplementation(async (p: string) => {
      if (p === rootPkgPath) return true;
      if (p === ws1PkgPath) return true;
      return false;
    });

    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).resolves.toBeUndefined();
  });

  it('skips non-directory entries in glob results', async () => {
    const packagesDir = path.join(repoRoot, 'packages');
    const rootPkg = JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/*'] });

    mockReadFile.mockImplementation(async (p: unknown) => {
      if (p === rootPkgPath) return rootPkg;
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readFile(p as string, 'utf8');
    });

    const fakeFile = { name: 'README.md', isDirectory: () => false } as unknown as Dirent;
    mockReaddir.mockImplementation(async (p: unknown) => {
      if (p === packagesDir) return [fakeFile] as Dirent[];
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readdir(p as string, { withFileTypes: true });
    });

    mockFileExists.mockImplementation(async (p: string) => {
      if (p === rootPkgPath) return true;
      return false;
    });

    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).resolves.toBeUndefined();
  });

  it('continues silently when glob base directory does not exist', async () => {
    const rootPkg = JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['nonexistent/*'] });

    mockReadFile.mockImplementation(async (p: unknown) => {
      if (p === rootPkgPath) return rootPkg;
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readFile(p as string, 'utf8');
    });

    mockReaddir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    mockFileExists.mockImplementation(async (p: string) => {
      if (p === rootPkgPath) return true;
      return false;
    });

    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).resolves.toBeUndefined();
  });

  it('throws ExitError for an unsupported glob pattern', async () => {
    const rootPkg = JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/**/*.ts'] });

    mockReadFile.mockImplementation(async (p: unknown) => {
      if (p === rootPkgPath) return rootPkg;
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readFile(p as string, 'utf8');
    });

    mockFileExists.mockImplementation(async (p: string) => {
      if (p === rootPkgPath) return true;
      return false;
    });

    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).rejects.toBeInstanceOf(ExitError);
  });
});

describe('main — shouldLogActions false branch', () => {
  it('--build without --dry-run calls spawn (logging skipped without verbose)', async () => {
    setArgs('--build');
    await expect(main()).resolves.toBeUndefined();
    expect(mockCrossSpawn).toHaveBeenCalled();
  });
});

describe('main — workspace version update without dry-run', () => {
  it('writes updated workspace package.json when a dep version changes', async () => {
    const ws1PkgPath = path.join(repoRoot, 'packages', 'ws1', 'package.json');
    const ws2PkgPath = path.join(repoRoot, 'packages', 'ws2', 'package.json');
    const rootPkg = JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/ws1', 'packages/ws2'] });
    const ws1Pkg = JSON.stringify({ name: 'ws1', version: '1.0.0' });
    const ws2Pkg = JSON.stringify({ name: 'ws2', version: '1.0.0', dependencies: { ws1: '1.0.0' } });

    mockReadFile.mockImplementation(async (p: unknown) => {
      if (p === rootPkgPath) return rootPkg;
      if (p === ws1PkgPath) return ws1Pkg;
      if (p === ws2PkgPath) return ws2Pkg;
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readFile(p as string, 'utf8');
    });
    mockFileExists.mockImplementation(async (p: string) => {
      if (p === rootPkgPath) return true;
      if (p === ws1PkgPath) return true;
      if (p === ws2PkgPath) return true;
      return false;
    });

    setArgs('--version', 'dev');
    await expect(main()).resolves.toBeUndefined();
    expect(vi.mocked(await import('node:fs/promises')).writeFile).toHaveBeenCalled();
  });
});

describe('main — verboseCommands branch', () => {
  it('--verbose flag covers the verboseCommands short-circuit in shouldLogActions', async () => {
    setArgs('--dry-run', '--build', '--verbose');
    await expect(main()).resolves.toBeUndefined();
  });
});

describe('main — workspace empty pattern', () => {
  it('skips empty string workspace patterns', async () => {
    const ws1PkgPath = path.join(repoRoot, 'packages', 'ws1', 'package.json');
    const rootPkg = JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['', 'packages/ws1'] });
    const ws1Pkg = JSON.stringify({ name: 'ws1', version: '1.0.0' });

    mockReadFile.mockImplementation(async (p: unknown) => {
      if (p === rootPkgPath) return rootPkg;
      if (p === ws1PkgPath) return ws1Pkg;
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readFile(p as string, 'utf8');
    });
    mockFileExists.mockImplementation(async (p: string) => {
      if (p === rootPkgPath) return true;
      if (p === ws1PkgPath) return true;
      return false;
    });

    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).resolves.toBeUndefined();
  });
});

describe('main — workspace glob candidate without package.json', () => {
  it('skips a glob-expanded directory whose package.json does not exist', async () => {
    const packagesDir = path.join(repoRoot, 'packages');
    const rootPkg = JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/*'] });

    const noPackageJsonDir = { name: 'nopkg', isDirectory: () => true } as unknown as Dirent;

    mockReadFile.mockImplementation(async (p: unknown) => {
      if (p === rootPkgPath) return rootPkg;
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readFile(p as string, 'utf8');
    });
    mockReaddir.mockImplementation(async (p: unknown) => {
      if (p === packagesDir) return [noPackageJsonDir] as Dirent[];
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readdir(p as string, { withFileTypes: true });
    });
    mockFileExists.mockImplementation(async (p: string) => {
      if (p === rootPkgPath) return true;
      return false;
    });

    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).resolves.toBeUndefined();
  });
});

describe('main — cross-workspace dep edge cases', () => {
  it('skips non-workspace dependencies during cross-workspace version update', async () => {
    const ws2PkgPath = path.join(repoRoot, 'packages', 'ws2', 'package.json');
    const rootPkg = JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/ws2'] });
    const ws2Pkg = JSON.stringify({ name: 'ws2', version: '1.0.0', dependencies: { 'external-pkg': '^2.0.0' } });

    mockReadFile.mockImplementation(async (p: unknown) => {
      if (p === rootPkgPath) return rootPkg;
      if (p === ws2PkgPath) return ws2Pkg;
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readFile(p as string, 'utf8');
    });
    mockFileExists.mockImplementation(async (p: string) => {
      if (p === rootPkgPath) return true;
      if (p === ws2PkgPath) return true;
      return false;
    });

    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).resolves.toBeUndefined();
  });

  it('skips self-dependency during cross-workspace version update', async () => {
    const ws2PkgPath = path.join(repoRoot, 'packages', 'ws2', 'package.json');
    const rootPkg = JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/ws2'] });
    const ws2Pkg = JSON.stringify({ name: 'ws2', version: '1.0.0', dependencies: { ws2: '1.0.0' } });

    mockReadFile.mockImplementation(async (p: unknown) => {
      if (p === rootPkgPath) return rootPkg;
      if (p === ws2PkgPath) return ws2Pkg;
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readFile(p as string, 'utf8');
    });
    mockFileExists.mockImplementation(async (p: string) => {
      if (p === rootPkgPath) return true;
      if (p === ws2PkgPath) return true;
      return false;
    });

    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).resolves.toBeUndefined();
  });

  it('does not update a dep already at the target version', async () => {
    const ws1PkgPath = path.join(repoRoot, 'packages', 'ws1', 'package.json');
    const ws2PkgPath = path.join(repoRoot, 'packages', 'ws2', 'package.json');
    const rootPkg = JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/ws1', 'packages/ws2'] });
    const ws1Pkg = JSON.stringify({ name: 'ws1', version: '1.0.0' });

    const d = new Date();
    const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const targetVersion = `1.0.0-dev-${dateStr}-abc1234`;

    const ws2Pkg = JSON.stringify({ name: 'ws2', version: '1.0.0', dependencies: { ws1: targetVersion } });

    mockReadFile.mockImplementation(async (p: unknown) => {
      if (p === rootPkgPath) return rootPkg;
      if (p === ws1PkgPath) return ws1Pkg;
      if (p === ws2PkgPath) return ws2Pkg;
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readFile(p as string, 'utf8');
    });
    mockFileExists.mockImplementation(async (p: string) => {
      if (p === rootPkgPath) return true;
      if (p === ws1PkgPath) return true;
      if (p === ws2PkgPath) return true;
      return false;
    });

    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).resolves.toBeUndefined();
    expect(vi.mocked(await import('node:fs/promises')).writeFile).not.toHaveBeenCalled();
  });
});

describe('main — reset with plugin package.json', () => {
  it('runs npm link when scripts.start is matterbridge', async () => {
    const rootPkg = JSON.stringify({ name: 'root', version: '1.0.0', scripts: { start: 'matterbridge' } });

    mockReadFile.mockImplementation(async (p: unknown) => {
      if (p === rootPkgPath) return rootPkg;
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readFile(p as string, 'utf8');
    });

    mockReaddir.mockImplementation(async () => [] as any);
    mockFileExists.mockImplementation(async (p: string) => {
      if (p === rootPkgPath) return true;
      const actual = await vi.importActual<typeof import('../src/clean.js')>('../src/clean.js');
      return actual.fileExists(p);
    });

    setArgs('--dry-run', '--reset');
    await expect(main()).resolves.toBeUndefined();
  });
});
