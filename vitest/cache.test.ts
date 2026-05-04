import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { beforeEach, describe, expect, it } from 'vitest';

import { backup, packageJsonMap, restore, tsconfigMap } from '../src/cache.js';
import { copyRepo } from '../src/helpers.js';

const monorepoPath = path.join(process.cwd(), 'vendor', 'monorepo');

beforeEach(async () => {
  await backup(monorepoPath);
});

describe('backup — packageJsonMap', () => {
  it('has keys for root and all workspace packages', () => {
    expect(packageJsonMap.has('@monorepo/monorepo')).toBe(true);
    expect(packageJsonMap.has('@monorepo/one')).toBe(true);
    expect(packageJsonMap.has('@monorepo/two')).toBe(true);
    expect(packageJsonMap.size).toBe(3);
  });

  it('stores parsed objects, not strings', () => {
    const root = packageJsonMap.get('@monorepo/monorepo');
    expect(typeof root).toBe('object');
    expect(root).not.toBeNull();
  });

  it('root package.json has correct name and version', () => {
    const root = packageJsonMap.get('@monorepo/monorepo');
    expect(root?.name).toBe('@monorepo/monorepo');
    expect(root?.version).toBe('1.0.0');
  });

  it('workspace package.json entries have correct names', () => {
    expect(packageJsonMap.get('@monorepo/one')?.name).toBe('@monorepo/one');
    expect(packageJsonMap.get('@monorepo/two')?.name).toBe('@monorepo/two');
  });

  it('stores the full parsed object (workspaces field present on root)', () => {
    const root = packageJsonMap.get('@monorepo/monorepo');
    expect(Array.isArray(root?.workspaces)).toBe(true);
  });
});

describe('backup — tsconfigMap', () => {
  it('has the expected 10 keys (4 root + 3 per workspace)', () => {
    const expected = [
      'tsconfig.json',
      'tsconfig.base.json',
      'tsconfig.build.json',
      'tsconfig.build.production.json',
      'packages/one/tsconfig.json',
      'packages/one/tsconfig.build.json',
      'packages/one/tsconfig.build.production.json',
      'packages/two/tsconfig.json',
      'packages/two/tsconfig.build.json',
      'packages/two/tsconfig.build.production.json',
    ];
    expect(tsconfigMap.size).toBe(expected.length);
    for (const key of expected) {
      expect(tsconfigMap.has(key)).toBe(true);
    }
  });

  it('stores parsed objects, not strings', () => {
    const tsconfig = tsconfigMap.get('tsconfig.json');
    expect(typeof tsconfig).toBe('object');
    expect(tsconfig).not.toBeNull();
  });

  it('root tsconfig.json has a compilerOptions property', () => {
    const tsconfig = tsconfigMap.get('tsconfig.json');
    expect(tsconfig).toHaveProperty('compilerOptions');
  });

  it('workspace tsconfig entries are parsed objects with content', () => {
    for (const key of ['packages/one/tsconfig.build.json', 'packages/two/tsconfig.build.json']) {
      const tsconfig = tsconfigMap.get(key);
      expect(typeof tsconfig).toBe('object');
      expect(tsconfig).not.toBeNull();
    }
  });
});

describe('backup — idempotency', () => {
  it('clears and re-populates on a second call', async () => {
    await backup(monorepoPath);
    expect(packageJsonMap.size).toBe(3);
    expect(tsconfigMap.size).toBe(10);
  });
});

describe('restore — package.json round-trip', () => {
  it('restores root package.json after version is modified on disk', async () => {
    const tmpDir = await copyRepo(monorepoPath, { install: false });
    try {
      await backup(tmpDir);
      const pkgPath = path.join(tmpDir, 'package.json');
      const modified = (await readFile(pkgPath, 'utf8')).replace(/"version": "1\.0\.0"/, '"version": "9.9.9"');
      await writeFile(pkgPath, modified);
      const onDisk = JSON.parse(await readFile(pkgPath, 'utf8')) as Record<string, unknown>;
      expect(onDisk.version).toBe('9.9.9');
      await restore(tmpDir);
      const restored = JSON.parse(await readFile(pkgPath, 'utf8')) as Record<string, unknown>;
      expect(restored.version).toBe('1.0.0');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('restores workspace package.json after content is modified on disk', async () => {
    const tmpDir = await copyRepo(monorepoPath, { install: false });
    try {
      await backup(tmpDir);
      const pkgPath = path.join(tmpDir, 'packages', 'one', 'package.json');
      const modified = (await readFile(pkgPath, 'utf8')).replace(/"version": "1\.0\.0"/, '"version": "9.9.9"');
      await writeFile(pkgPath, modified);
      await restore(tmpDir);
      const restored = JSON.parse(await readFile(pkgPath, 'utf8')) as Record<string, unknown>;
      expect(restored.version).toBe('1.0.0');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('restore — tsconfig round-trip', () => {
  it('restores root tsconfig.json after it is overwritten on disk', async () => {
    const tmpDir = await copyRepo(monorepoPath, { install: false });
    try {
      await backup(tmpDir);
      const tsPath = path.join(tmpDir, 'tsconfig.json');
      await writeFile(tsPath, '{}');
      const onDisk = JSON.parse(await readFile(tsPath, 'utf8')) as Record<string, unknown>;
      expect(onDisk).toEqual({});
      await restore(tmpDir);
      const restored = JSON.parse(await readFile(tsPath, 'utf8')) as Record<string, unknown>;
      expect(restored).toHaveProperty('compilerOptions');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('restores workspace tsconfig after it is overwritten on disk', async () => {
    const tmpDir = await copyRepo(monorepoPath, { install: false });
    try {
      await backup(tmpDir);
      const tsPath = path.join(tmpDir, 'packages', 'one', 'tsconfig.build.json');
      await writeFile(tsPath, '{}');
      await restore(tmpDir);
      const restored = JSON.parse(await readFile(tsPath, 'utf8')) as Record<string, unknown>;
      expect(restored).not.toEqual({});
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('backup — workspace object format and name-less workspace', () => {
  it('handles { packages: [...] } workspace format and a workspace with no name field', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-cache-'));
    try {
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'obj-root', workspaces: { packages: ['packages/*'] } }));
      await mkdir(path.join(tmpDir, 'packages', 'one'), { recursive: true });
      // workspace without a name field — covers the `pkg.name ?? ''` true branch
      await writeFile(path.join(tmpDir, 'packages', 'one', 'package.json'), JSON.stringify({ version: '1.0.0' }));
      await backup(tmpDir);
      expect(packageJsonMap.has('obj-root')).toBe(true);
      // name defaults to '' when missing
      expect(packageJsonMap.has('')).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('backup — no workspaces field', () => {
  it('returns only the root package when there are no workspaces', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-cache-'));
    try {
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'solo-root' }));
      await backup(tmpDir);
      expect(packageJsonMap.size).toBe(1);
      expect(packageJsonMap.has('solo-root')).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('backup — root package.json without name field', () => {
  it('keys the root package.json by empty string when name is absent', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-cache-'));
    try {
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
      await backup(tmpDir);
      expect(packageJsonMap.has('')).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('backup — workspace pattern edge cases', () => {
  it('skips empty string patterns and resolves explicit non-glob paths', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-cache-'));
    try {
      // '' → !trimmed true; 'packages/one' → explicit path + fileExists true;
      // 'packages/missing' → explicit path + fileExists false
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'e-root', workspaces: ['', 'packages/one', 'packages/missing'] }));
      await mkdir(path.join(tmpDir, 'packages', 'one'), { recursive: true });
      await writeFile(path.join(tmpDir, 'packages', 'one', 'package.json'), JSON.stringify({ name: 'e-one' }));
      await backup(tmpDir);
      expect(packageJsonMap.has('e-root')).toBe(true);
      expect(packageJsonMap.has('e-one')).toBe(true);
      expect(packageJsonMap.size).toBe(2);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('silently ignores a complex glob pattern and a glob with a missing base dir', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-cache-'));
    try {
      // 'complex/**' has glob chars but is not a simple dir/* → false branch of trimmed.endsWith('/*')
      // 'nonexistent/*' → readdir catch in resolveWorkspacePackageJsonPaths
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'cg-root', workspaces: ['complex/**', 'nonexistent/*'] }));
      await backup(tmpDir);
      expect(packageJsonMap.has('cg-root')).toBe(true);
      expect(packageJsonMap.size).toBe(1);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('ignores non-directory entries and subdirs without package.json in a glob pattern', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-cache-'));
    try {
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'g-root', workspaces: ['packages/*'] }));
      await mkdir(path.join(tmpDir, 'packages'), { recursive: true });
      // non-dir file in packages/ → !entry.isDirectory() true
      await writeFile(path.join(tmpDir, 'packages', 'notadir.txt'), '');
      // subdir without package.json → fileExists false in glob branch
      await mkdir(path.join(tmpDir, 'packages', 'empty'), { recursive: true });
      // subdir with package.json
      await mkdir(path.join(tmpDir, 'packages', 'one'), { recursive: true });
      await writeFile(path.join(tmpDir, 'packages', 'one', 'package.json'), JSON.stringify({ name: 'g-one' }));
      await backup(tmpDir);
      expect(packageJsonMap.has('g-root')).toBe(true);
      expect(packageJsonMap.has('g-one')).toBe(true);
      expect(packageJsonMap.size).toBe(2);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('restore — ghost entry in packageJsonMap', () => {
  it('skips writing a package.json whose path is not in the path cache', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-cache-'));
    try {
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'gr-root', version: '1.0.0' }));
      await backup(tmpDir);
      // inject an entry with no corresponding _packageJsonPaths record
      packageJsonMap.set('ghost', { name: 'ghost' });
      await expect(restore(tmpDir)).resolves.toBeUndefined();
      const onDisk = JSON.parse(await readFile(path.join(tmpDir, 'package.json'), 'utf8')) as Record<string, unknown>;
      expect(onDisk.name).toBe('gr-root');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
