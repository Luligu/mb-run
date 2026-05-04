import path from 'node:path';
import process from 'node:process';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from '../src/module.js';

const vendorLibraryPath = path.join(process.cwd(), 'vendor', 'library');

let logLines: string[];

function logged(...tokens: string[]): boolean {
  return logLines.some((line) => tokens.every((t) => line.includes(t)));
}

function setArgs(...args: string[]): void {
  process.argv = ['node', 'mb-run', ...args];
}

beforeEach(() => {
  logLines = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => logLines.push(String(args[0])));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'cwd').mockReturnValue(vendorLibraryPath);
});

describe('repo.library — dry-run operations', () => {
  it('--dry-run --clean logs delete operations', async () => {
    setArgs('--dry-run', '--clean');
    await expect(main()).resolves.toBeUndefined();
    expect(logged('delete', 'dist')).toBe(true);
  });

  it('--dry-run --build logs the tsc build command', async () => {
    setArgs('--dry-run', '--build');
    await expect(main()).resolves.toBeUndefined();
    expect(logged('tsc')).toBe(true);
  });

  it('--dry-run --build --production logs the tsc build command', async () => {
    setArgs('--dry-run', '--build', '--production');
    await expect(main()).resolves.toBeUndefined();
    expect(logged('tsc')).toBe(true);
  });

  it('--dry-run --lint logs the eslint command', async () => {
    setArgs('--dry-run', '--lint');
    await expect(main()).resolves.toBeUndefined();
    expect(logged('eslint')).toBe(true);
  });

  it('--dry-run --format logs the prettier command', async () => {
    setArgs('--dry-run', '--format');
    await expect(main()).resolves.toBeUndefined();
    expect(logged('prettier')).toBe(true);
  });

  it('--dry-run --reset logs npm install and tsc build', async () => {
    setArgs('--dry-run', '--reset');
    await expect(main()).resolves.toBeUndefined();
    expect(logged('npm', 'install')).toBe(true);
    expect(logged('tsc')).toBe(true);
  });

  it('--dry-run --version dev logs npm version with the dev tag', async () => {
    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).resolves.toBeUndefined();
    expect(logged('npm', 'version')).toBe(true);
    expect(logged('dev')).toBe(true);
  });

  it('--dry-run --version logs npm version', async () => {
    setArgs('--dry-run', '--version');
    await expect(main()).resolves.toBeUndefined();
    expect(logged('npm', 'version')).toBe(true);
  });
});
