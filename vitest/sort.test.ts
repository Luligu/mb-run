import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PACKAGE_JSON_KEY_ORDER, sortAll, sortPackageJson } from '../src/sort.js';

describe('PACKAGE_JSON_KEY_ORDER', () => {
  it('starts with name then version', () => {
    expect(PACKAGE_JSON_KEY_ORDER[0]).toBe('name');
    expect(PACKAGE_JSON_KEY_ORDER[1]).toBe('version');
  });

  it('places scripts before dependencies', () => {
    const scriptsIdx = PACKAGE_JSON_KEY_ORDER.indexOf('scripts');
    const depsIdx = PACKAGE_JSON_KEY_ORDER.indexOf('dependencies');
    expect(scriptsIdx).toBeLessThan(depsIdx);
  });

  it('places dependencies before devDependencies', () => {
    const depsIdx = PACKAGE_JSON_KEY_ORDER.indexOf('dependencies');
    const devIdx = PACKAGE_JSON_KEY_ORDER.indexOf('devDependencies');
    expect(depsIdx).toBeLessThan(devIdx);
  });

  it('places peerDependencies after devDependencies', () => {
    const devIdx = PACKAGE_JSON_KEY_ORDER.indexOf('devDependencies');
    const peerIdx = PACKAGE_JSON_KEY_ORDER.indexOf('peerDependencies');
    expect(peerIdx).toBeGreaterThan(devIdx);
  });

  it('ends with bundleDependencies', () => {
    expect(PACKAGE_JSON_KEY_ORDER[PACKAGE_JSON_KEY_ORDER.length - 1]).toBe('bundleDependencies');
  });
});

describe('sortPackageJson', () => {
  it('returns a new object and does not mutate the input', () => {
    const pkg = { version: '1.0.0', name: 'test' };
    const result = sortPackageJson(pkg);
    expect(result).not.toBe(pkg);
    expect(Object.keys(pkg)).toEqual(['version', 'name']);
  });

  it('reorders known top-level keys to match PACKAGE_JSON_KEY_ORDER', () => {
    const pkg: Record<string, unknown> = { scripts: {}, version: '1.0.0', name: 'test', dependencies: {} };
    const sorted = sortPackageJson(pkg);
    const keys = Object.keys(sorted);
    expect(keys.indexOf('name')).toBeLessThan(keys.indexOf('version'));
    expect(keys.indexOf('version')).toBeLessThan(keys.indexOf('scripts'));
    expect(keys.indexOf('scripts')).toBeLessThan(keys.indexOf('dependencies'));
  });

  it('appends unknown keys after all known keys, preserving their relative order', () => {
    const pkg: Record<string, unknown> = { zzz: 1, name: 'test', aaa: 2, version: '1.0.0' };
    const sorted = sortPackageJson(pkg);
    const keys = Object.keys(sorted);
    expect(keys.indexOf('name')).toBeLessThan(keys.indexOf('zzz'));
    expect(keys.indexOf('name')).toBeLessThan(keys.indexOf('aaa'));
    expect(keys.indexOf('zzz')).toBeLessThan(keys.indexOf('aaa'));
  });

  it('preserves values unchanged — sub-properties are not reordered', () => {
    const pkg: Record<string, unknown> = {
      name: 'test',
      scripts: { build: 'tsc', clean: 'rm -rf dist' },
      keywords: ['z', 'a', 'b'],
    };
    const sorted = sortPackageJson(pkg);
    expect(sorted.name).toBe('test');
    expect(sorted.scripts).toEqual({ build: 'tsc', clean: 'rm -rf dist' });
    expect(sorted.keywords).toEqual(['z', 'a', 'b']);
  });

  it('orders optional dependency sections correctly after devDependencies', () => {
    const pkg: Record<string, unknown> = {
      optionalDependencies: { d: '1' },
      peerDependencies: { a: '1' },
      name: 'test',
      bundleDependencies: ['c'],
      peerDependenciesMeta: { a: { optional: true } },
    };
    const sorted = sortPackageJson(pkg);
    const keys = Object.keys(sorted);
    expect(keys.indexOf('peerDependencies')).toBeLessThan(keys.indexOf('peerDependenciesMeta'));
    expect(keys.indexOf('peerDependenciesMeta')).toBeLessThan(keys.indexOf('optionalDependencies'));
    expect(keys.indexOf('optionalDependencies')).toBeLessThan(keys.indexOf('bundleDependencies'));
  });

  it('handles a package with no known keys — returns all keys in original order', () => {
    const pkg: Record<string, unknown> = { zzz: 'z', aaa: 'a' };
    const sorted = sortPackageJson(pkg);
    expect(Object.keys(sorted)).toEqual(['zzz', 'aaa']);
  });

  it('handles an empty object', () => {
    expect(sortPackageJson({})).toEqual({});
  });

  it('is idempotent — sorting an already-sorted object produces the same key order', () => {
    const pkg: Record<string, unknown> = { name: 'test', version: '1.0.0', scripts: {}, dependencies: {} };
    const once = sortPackageJson(pkg);
    const twice = sortPackageJson(once);
    expect(Object.keys(twice)).toEqual(Object.keys(once));
  });
});

describe('sortAll', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sort-test-'));
    const pkgADir = path.join(tmpDir, 'packages', 'pkg-a');
    await mkdir(pkgADir, { recursive: true });
    // Root package — keys deliberately out of canonical order
    const rootPkg = { scripts: { build: 'tsc' }, name: 'root', workspaces: ['packages/*'], version: '1.0.0', dependencies: { 'pkg-a': '1.0.0' } };
    // Workspace package — keys deliberately out of canonical order
    const workspacePkg = { scripts: { build: 'tsc' }, name: 'pkg-a', version: '1.0.0' };
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(rootPkg, null, 2));
    await writeFile(path.join(pkgADir, 'package.json'), JSON.stringify(workspacePkg, null, 2));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes sorted package.json files to disk with name as the first key', async () => {
    await sortAll(tmpDir);
    const raw = await readFile(path.join(tmpDir, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(pkg)[0]).toBe('name');
  });

  it('sorts all workspace package.json files', async () => {
    await sortAll(tmpDir);
    const raw = await readFile(path.join(tmpDir, 'packages', 'pkg-a', 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(pkg)[0]).toBe('name');
  });

  it('preserves all original keys and values after sorting', async () => {
    await sortAll(tmpDir);
    const raw = await readFile(path.join(tmpDir, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    expect(pkg.name).toBe('root');
    expect(pkg.version).toBe('1.0.0');
    expect(pkg.dependencies).toEqual({ 'pkg-a': '1.0.0' });
  });

  it('places name before version and version before scripts in sorted output', async () => {
    await sortAll(tmpDir);
    const raw = await readFile(path.join(tmpDir, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const keys = Object.keys(pkg);
    expect(keys.indexOf('name')).toBeLessThan(keys.indexOf('version'));
    expect(keys.indexOf('version')).toBeLessThan(keys.indexOf('scripts'));
  });

  it('is idempotent — running sortAll twice produces identical files', async () => {
    await sortAll(tmpDir);
    const afterFirst = await readFile(path.join(tmpDir, 'package.json'), 'utf8');
    await sortAll(tmpDir);
    const afterSecond = await readFile(path.join(tmpDir, 'package.json'), 'utf8');
    expect(afterSecond).toBe(afterFirst);
  });
});
