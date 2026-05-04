import { execSync } from 'node:child_process';
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from '../src/module.js';

const monorepoPath = path.join(process.cwd(), 'vendor', 'monorepo');
const distPath = path.join(monorepoPath, 'dist');
const pkgOneDist = path.join(monorepoPath, 'packages', 'one', 'dist');
const pkgTwoDist = path.join(monorepoPath, 'packages', 'two', 'dist');
const packageJsonPath = path.join(monorepoPath, 'package.json');
const pkgOneJsonPath = path.join(monorepoPath, 'packages', 'one', 'package.json');
const pkgTwoJsonPath = path.join(monorepoPath, 'packages', 'two', 'package.json');
const packageLockPath = path.join(monorepoPath, 'package-lock.json');
const buildInfoPath = path.join(monorepoPath, 'tsconfig.build.tsbuildinfo');
const buildProductionInfoPath = path.join(monorepoPath, 'tsconfig.build.production.tsbuildinfo');
const pkgOneBuildInfoPath = path.join(monorepoPath, 'packages', 'one', 'tsconfig.build.tsbuildinfo');
const pkgTwoBuildInfoPath = path.join(monorepoPath, 'packages', 'two', 'tsconfig.build.tsbuildinfo');

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
  if (!(await exists(path.join(monorepoPath, 'node_modules')))) {
    execSync('npm install --no-fund --no-audit', { cwd: monorepoPath, stdio: 'inherit' });
  }
}, 120_000);

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'cwd').mockReturnValue(monorepoPath);
});

describe('repo.monorepo — real operations', () => {
  it('--clean removes dist and all .tsbuildinfo files for root and packages', async () => {
    await mkdir(distPath, { recursive: true });
    await mkdir(pkgOneDist, { recursive: true });
    await mkdir(pkgTwoDist, { recursive: true });
    await writeFile(buildInfoPath, '');
    await writeFile(buildProductionInfoPath, '');
    await writeFile(pkgOneBuildInfoPath, '');
    await writeFile(pkgTwoBuildInfoPath, '');
    setArgs('--clean');
    await expect(main()).resolves.toBeUndefined();
    expect(await exists(distPath)).toBe(false);
    expect(await exists(pkgOneDist)).toBe(false);
    expect(await exists(pkgTwoDist)).toBe(false);
    expect(await exists(buildInfoPath)).toBe(false);
    expect(await exists(buildProductionInfoPath)).toBe(false);
    expect(await exists(pkgOneBuildInfoPath)).toBe(false);
    expect(await exists(pkgTwoBuildInfoPath)).toBe(false);
  }, 30_000);

  it('--build creates dist/module.js for root and both packages', async () => {
    setArgs('--build');
    await expect(main()).resolves.toBeUndefined();
    expect(await exists(path.join(distPath, 'module.js'))).toBe(true);
    expect(await exists(path.join(pkgOneDist, 'module.js'))).toBe(true);
    expect(await exists(path.join(pkgTwoDist, 'module.js'))).toBe(true);
  }, 60_000);

  it('--build --production creates dist/module.js for root and both packages', async () => {
    setArgs('--build', '--production');
    await expect(main()).resolves.toBeUndefined();
    expect(await exists(path.join(distPath, 'module.js'))).toBe(true);
    expect(await exists(path.join(pkgOneDist, 'module.js'))).toBe(true);
    expect(await exists(path.join(pkgTwoDist, 'module.js'))).toBe(true);
  }, 60_000);

  it('--lint passes on the monorepo source', async () => {
    setArgs('--lint');
    await expect(main()).resolves.toBeUndefined();
  }, 60_000);

  it('--format succeeds on the monorepo source', async () => {
    setArgs('--format');
    await expect(main()).resolves.toBeUndefined();
  }, 30_000);

  it('--version dev tags root and workspace versions with the dev prerelease format', async () => {
    const savedRoot = await readFile(packageJsonPath, 'utf8');
    const savedOne = await readFile(pkgOneJsonPath, 'utf8');
    const savedTwo = await readFile(pkgTwoJsonPath, 'utf8');
    const hadLock = await exists(packageLockPath);
    try {
      setArgs('--version', 'dev');
      await expect(main()).resolves.toBeUndefined();
      const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version: string; dependencies: Record<string, string> };
      expect(pkg.version).toMatch(/^1\.0\.0-dev-\d{8}-[0-9a-f]{7}$/u);
      expect(pkg.dependencies['@monorepo/one']).toMatch(/^1\.0\.0-dev-\d{8}-[0-9a-f]{7}$/u);
      expect(pkg.dependencies['@monorepo/two']).toMatch(/^1\.0\.0-dev-\d{8}-[0-9a-f]{7}$/u);
    } finally {
      await writeFile(packageJsonPath, savedRoot, 'utf8');
      await writeFile(pkgOneJsonPath, savedOne, 'utf8');
      await writeFile(pkgTwoJsonPath, savedTwo, 'utf8');
      if (!hadLock) await rm(packageLockPath, { force: true });
    }
  }, 30_000);

  it('--version strips root and workspace versions to base semver', async () => {
    const savedRoot = await readFile(packageJsonPath, 'utf8');
    const savedOne = await readFile(pkgOneJsonPath, 'utf8');
    const savedTwo = await readFile(pkgTwoJsonPath, 'utf8');
    const hadLock = await exists(packageLockPath);
    try {
      setArgs('--version');
      await expect(main()).resolves.toBeUndefined();
      const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version: string; dependencies: Record<string, string> };
      expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/u);
      expect(pkg.dependencies['@monorepo/one']).toMatch(/^\d+\.\d+\.\d+$/u);
      expect(pkg.dependencies['@monorepo/two']).toMatch(/^\d+\.\d+\.\d+$/u);
    } finally {
      await writeFile(packageJsonPath, savedRoot, 'utf8');
      await writeFile(pkgOneJsonPath, savedOne, 'utf8');
      await writeFile(pkgTwoJsonPath, savedTwo, 'utf8');
      if (!hadLock) await rm(packageLockPath, { force: true });
    }
  }, 30_000);

  it('--pack produces a tgz, sets bundleDependencies, and restores package.json', async () => {
    const savedRoot = await readFile(packageJsonPath, 'utf8');
    const savedLock = (await exists(packageLockPath)) ? await readFile(packageLockPath, 'utf8') : null;
    try {
      setArgs('--pack');
      await expect(main()).resolves.toBeUndefined();

      // tgz should exist
      const entries = await readdir(monorepoPath);
      expect(entries.filter((e) => e.endsWith('.tgz')).length).toBeGreaterThan(0);

      // package.json should be fully restored (no bundleDependencies, scripts present)
      const restored = JSON.parse(await readFile(packageJsonPath, 'utf8')) as Record<string, unknown>;
      expect(restored['bundleDependencies']).toBeUndefined();
      expect(restored['scripts']).toBeDefined();
      expect(restored['devDependencies']).toBeDefined();
    } finally {
      await writeFile(packageJsonPath, savedRoot, 'utf8');
      if (savedLock !== null) await writeFile(packageLockPath, savedLock, 'utf8');
      else await rm(packageLockPath, { force: true });
      // clean up generated tgz files
      const entries = await readdir(monorepoPath);
      await Promise.all(entries.filter((e) => e.endsWith('.tgz')).map((e) => rm(path.join(monorepoPath, e), { force: true })));
    }
  }, 120_000);
});
