import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from '../src/module.js';

const vendorToolPath = path.join(process.cwd(), 'vendor', 'tool');

const distPath = path.join(vendorToolPath, 'dist');
const packageJsonPath = path.join(vendorToolPath, 'package.json');
const packageLockPath = path.join(vendorToolPath, 'package-lock.json');
const buildInfoPath = path.join(vendorToolPath, 'tsconfig.build.tsbuildinfo');
const buildProductionInfoPath = path.join(vendorToolPath, 'tsconfig.build.production.tsbuildinfo');

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

afterAll(async () => {
  await rm(distPath, { recursive: true, force: true });
  await rm(buildInfoPath, { force: true });
  await rm(buildProductionInfoPath, { force: true });
});

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'cwd').mockReturnValue(vendorToolPath);
});

describe('repo.tool — real operations', () => {
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

  it('--lint passes on the tool source', async () => {
    setArgs('--lint');
    await expect(main()).resolves.toBeUndefined();
  }, 120_000);

  it('--format succeeds on the tool source', async () => {
    setArgs('--format');
    await expect(main()).resolves.toBeUndefined();
  }, 30_000);

  it('--version dev tags the version with the dev prerelease format', async () => {
    const savedPkg = await readFile(packageJsonPath, 'utf8');
    const savedLock = await readFile(packageLockPath, 'utf8').catch(() => null);
    try {
      setArgs('--version', 'dev');
      await expect(main()).resolves.toBeUndefined();
      const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version: string };
      expect(pkg.version).toMatch(/^1\.0\.0-dev-\d{8}-[0-9a-f]{7}$/u);
    } finally {
      await writeFile(packageJsonPath, savedPkg, 'utf8');
      if (savedLock !== null) await writeFile(packageLockPath, savedLock, 'utf8');
      else await rm(packageLockPath, { force: true });
    }
  }, 30_000);

  it('--version strips the prerelease tag to base semver', async () => {
    const savedPkg = await readFile(packageJsonPath, 'utf8');
    const savedLock = await readFile(packageLockPath, 'utf8').catch(() => null);
    try {
      setArgs('--version');
      await expect(main()).resolves.toBeUndefined();
      const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version: string };
      expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/u);
    } finally {
      await writeFile(packageJsonPath, savedPkg, 'utf8');
      if (savedLock !== null) await writeFile(packageLockPath, savedLock, 'utf8');
      else await rm(packageLockPath, { force: true });
    }
  }, 30_000);
});
