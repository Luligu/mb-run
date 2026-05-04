import { execSync } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from '../src/module.js';

const pluginRepoPath = path.join(process.cwd(), 'vendor', 'plugin');
const distPath = path.join(pluginRepoPath, 'dist');
const packageJsonPath = path.join(pluginRepoPath, 'package.json');
const packageLockPath = path.join(pluginRepoPath, 'package-lock.json');
const buildInfoPath = path.join(pluginRepoPath, 'tsconfig.build.tsbuildinfo');
const buildProductionInfoPath = path.join(pluginRepoPath, 'tsconfig.build.production.tsbuildinfo');

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function setArgs(...args: string[]): void {
  process.argv = ['node', 'mb-run', ...args];
}

beforeAll(async () => {
  if (!(await exists(path.join(pluginRepoPath, 'node_modules')))) {
    execSync('npm install --no-fund --no-audit', { cwd: pluginRepoPath, stdio: 'inherit' });
  }
  if (!(await exists(path.join(pluginRepoPath, 'node_modules', 'matterbridge')))) {
    try {
      execSync('npm link --no-fund --no-audit matterbridge', { cwd: pluginRepoPath, stdio: 'inherit' });
    } catch {
      execSync('npm install --no-fund --no-audit matterbridge', { cwd: pluginRepoPath, stdio: 'inherit' });
    }
  }
}, 300_000);

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'cwd').mockReturnValue(pluginRepoPath);
});

describe('repo.plugin — real operations', () => {
  it('--clean removes dist and all .tsbuildinfo files', async () => {
    await mkdir(distPath, { recursive: true });
    await writeFile(buildInfoPath, '');
    await writeFile(buildProductionInfoPath, '');
    setArgs('--clean');
    await expect(main()).resolves.toBeUndefined();
    expect(await exists(distPath)).toBe(false);
    expect(await exists(buildInfoPath)).toBe(false);
    expect(await exists(buildProductionInfoPath)).toBe(false);
  }, 30_000);

  it('--build creates dist/module.js', async () => {
    setArgs('--build');
    await expect(main()).resolves.toBeUndefined();
    expect(await exists(path.join(distPath, 'module.js'))).toBe(true);
  }, 60_000);

  it('--build --production creates dist/module.js', async () => {
    setArgs('--build', '--production');
    await expect(main()).resolves.toBeUndefined();
    expect(await exists(path.join(distPath, 'module.js'))).toBe(true);
  }, 60_000);

  it('--lint passes on the plugin source', async () => {
    setArgs('--lint');
    await expect(main()).resolves.toBeUndefined();
  }, 120_000);

  it('--format succeeds on the plugin source', async () => {
    setArgs('--format');
    await expect(main()).resolves.toBeUndefined();
  }, 30_000);

  it('--reset (dry-run) logs npm link --no-fund --no-audit matterbridge', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => logged.push(String(args[0])));
    setArgs('--dry-run', '--reset');
    await expect(main()).resolves.toBeUndefined();
    expect(logged.some((line) => line.includes('link') && line.includes('matterbridge'))).toBe(true);
  }, 30_000);

  it('--version dev tags the version with the dev prerelease format', async () => {
    const savedPkg = await readFile(packageJsonPath, 'utf8');
    const hadLock = await exists(packageLockPath);
    try {
      setArgs('--version', 'dev');
      await expect(main()).resolves.toBeUndefined();
      const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version: string };
      expect(pkg.version).toMatch(/^1\.0\.0-dev-\d{8}-[0-9a-f]{7}$/u);
    } finally {
      await writeFile(packageJsonPath, savedPkg, 'utf8');
      if (!hadLock) await rm(packageLockPath, { force: true });
    }
  }, 30_000);

  it('--version strips the prerelease tag to base semver', async () => {
    const savedPkg = await readFile(packageJsonPath, 'utf8');
    const hadLock = await exists(packageLockPath);
    try {
      setArgs('--version');
      await expect(main()).resolves.toBeUndefined();
      const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version: string };
      expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/u);
    } finally {
      await writeFile(packageJsonPath, savedPkg, 'utf8');
      if (!hadLock) await rm(packageLockPath, { force: true });
    }
  }, 30_000);
});
