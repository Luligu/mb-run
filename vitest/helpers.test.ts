import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isMonorepo, isPlugin, parsePackageJson } from '../src/helpers.js';

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
});
