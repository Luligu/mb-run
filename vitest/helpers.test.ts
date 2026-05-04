import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { copyRepo, isMonorepo, isPlugin, parsePackageJson } from '../src/helpers.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execSync: vi.fn(actual.execSync) };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn((...args: Parameters<typeof actual.readFile>) => actual.readFile(...args)) };
});

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-helpers-'));
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
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-plugin', scripts: { 'dev:link': 'npm link --no-fund --no-audit matterbridge' } }));
    expect(await isPlugin(tmpDir)).toBe(true);
  });

  it('returns false when scripts.start is something else', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-tool', scripts: { start: 'node dist/bin/hello.js' } }));
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
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-lib', scripts: { 'dev:link': 'npm link matterbridge' } }));
    expect(await isPlugin(tmpDir)).toBe(false);
  });
});

describe('isMonorepo', () => {
  it('returns true when workspaces is an array', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-monorepo', workspaces: ['packages/*'] }));
    expect(await isMonorepo(tmpDir)).toBe(true);
  });

  it('returns true when workspaces is an object', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-monorepo', workspaces: { packages: ['packages/*'] } }));
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
    const pkg = { name: 'my-pkg', version: '1.0.0', scripts: { start: 'node dist/index.js' } };
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

describe('copyRepo', () => {
  let destDir = '';

  afterEach(async () => {
    if (destDir) await rm(destDir, { recursive: true, force: true });
    destDir = '';
  });

  it('copies files and directories to a new temp directory', async () => {
    await mkdir(path.join(tmpDir, 'src'));
    await writeFile(path.join(tmpDir, 'package.json'), '{"name":"test"}');
    await writeFile(path.join(tmpDir, 'src', 'index.ts'), '');
    destDir = await copyRepo(tmpDir, { install: false });
    await expect(access(path.join(destDir, 'package.json'))).resolves.toBeUndefined();
    await expect(access(path.join(destDir, 'src', 'index.ts'))).resolves.toBeUndefined();
  });

  it('returns an absolute path', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), '{}');
    destDir = await copyRepo(tmpDir, { install: false });
    expect(path.isAbsolute(destDir)).toBe(true);
  });

  it('excludes node_modules directory', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), '{}');
    await mkdir(path.join(tmpDir, 'node_modules'));
    await writeFile(path.join(tmpDir, 'node_modules', 'pkg.js'), '');
    destDir = await copyRepo(tmpDir, { install: false });
    await expect(access(path.join(destDir, 'node_modules'))).rejects.toThrow();
  });

  it('excludes dist, dist-jest, .cache, coverage directories', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), '{}');
    for (const dir of ['dist', 'dist-jest', '.cache', 'coverage']) {
      await mkdir(path.join(tmpDir, dir));
      await writeFile(path.join(tmpDir, dir, 'file.js'), '');
    }
    destDir = await copyRepo(tmpDir, { install: false });
    for (const dir of ['dist', 'dist-jest', '.cache', 'coverage']) {
      await expect(access(path.join(destDir, dir))).rejects.toThrow();
    }
  });

  it('excludes .tsbuildinfo and .tgz files', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), '{}');
    await writeFile(path.join(tmpDir, 'tsconfig.build.tsbuildinfo'), '');
    await writeFile(path.join(tmpDir, 'package.tgz'), '');
    destDir = await copyRepo(tmpDir, { install: false });
    await expect(access(path.join(destDir, 'tsconfig.build.tsbuildinfo'))).rejects.toThrow();
    await expect(access(path.join(destDir, 'package.tgz'))).rejects.toThrow();
  });

  it('copies nested directories recursively', async () => {
    await mkdir(path.join(tmpDir, 'packages', 'one'), { recursive: true });
    await writeFile(path.join(tmpDir, 'package.json'), '{}');
    await writeFile(path.join(tmpDir, 'packages', 'one', 'package.json'), '{"name":"one"}');
    destDir = await copyRepo(tmpDir, { install: false });
    await expect(access(path.join(destDir, 'packages', 'one', 'package.json'))).resolves.toBeUndefined();
  });

  it('falls back to npm install when npm link throws (linkMatterbridge branch)', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), '{}');
    const cp = await import('node:child_process');
    const execSyncMock = vi.mocked(cp.execSync);
    // install succeeds; link throws; fallback install succeeds
    execSyncMock
      .mockImplementationOnce(() => Buffer.from('')) // npm install
      .mockImplementationOnce(() => {
        throw new Error('link failed');
      }) // npm link
      .mockImplementationOnce(() => Buffer.from('')); // npm install fallback
    destDir = await copyRepo(tmpDir, { install: true, linkMatterbridge: true });
    expect(execSyncMock).toHaveBeenCalledTimes(3);
    expect(execSyncMock.mock.calls[2]?.[0]).toContain('npm install');
    execSyncMock.mockRestore();
  });

  it('runs git init when gitInit is true', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), '{}');
    const cp = await import('node:child_process');
    const execSyncMock = vi.mocked(cp.execSync);
    execSyncMock.mockImplementation(() => Buffer.from(''));
    destDir = await copyRepo(tmpDir, { install: false, gitInit: true });
    const gitCall = execSyncMock.mock.calls.find((c) => String(c[0]).includes('git init'));
    expect(gitCall).toBeDefined();
    execSyncMock.mockRestore();
  });

  it('skips symlinks (neither directory nor file) silently', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), '{}');
    await writeFile(path.join(tmpDir, 'real.txt'), 'content');
    await symlink(path.join(tmpDir, 'real.txt'), path.join(tmpDir, 'link.txt'));
    destDir = await copyRepo(tmpDir, { install: false });
    // real file is copied, symlink is skipped (no throw)
    await expect(access(path.join(destDir, 'real.txt'))).resolves.toBeUndefined();
    await expect(access(path.join(destDir, 'link.txt'))).rejects.toThrow();
  });
});
