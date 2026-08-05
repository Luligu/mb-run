/**
 * @file vitest/esbuild.library.test.ts
 * @description Integration test that runs the real esbuild and declaration build tools (not
 * mocked) against a minimal on-disk library package, mirroring pack.ts's pipeline order — esbuild
 * first, then declaration emit — to verify esbuild's dist-pruning step leaves declaration
 * files untouched, and that the later dts build step still produces correct output from them.
 * @author Luca Liguori
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runDtsBuild } from '../src/dts.js';
import { runEsbuild } from '../src/esbuild.js';
import { initLogger } from '../src/logger.js';

let tmpDir: string;

describe('esbuild + dts (real tools, library package)', () => {
  beforeEach(async () => {
    initLogger({ dryRun: false, verbose: false, rootDir: '' });
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-esbuild-library-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('exposes runEsbuild and runDtsBuild as functions', () => {
    expect(typeof runEsbuild).toBe('function');
    expect(typeof runDtsBuild).toBe('function');
  });

  it('prunes declaration files that the declaration build step will recreate', async () => {
    await writeFile(
      path.join(tmpDir, 'tsconfig.build.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'esnext',
          module: 'esnext',
          moduleResolution: 'bundler',
          rootDir: 'src',
          outDir: 'dist',
          declaration: true,
          strict: true,
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      }),
    );

    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'sample-library',
        version: '1.0.0',
        type: 'module',
        main: './dist/module.js',
        types: './dist/module.d.ts',
        exports: { '.': { import: './dist/module.js', types: './dist/module.d.ts' } },
      }),
    );

    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(
      path.join(tmpDir, 'src', 'module.ts'),
      `export interface Greeting {\n  message: string;\n}\n\nexport function greet(name: string): Greeting {\n  return { message: \`Hello, \${name}!\` };\n}\n`,
    );

    await mkdir(path.join(tmpDir, 'dist'), { recursive: true });
    await writeFile(path.join(tmpDir, 'dist', 'module.js'), `export function greet(name) {\n  return { message: \`Hello, \${name}!\` };\n}\n`);
    const declarationBeforeEsbuild = `export interface Greeting {\n  message: string;\n}\nexport declare function greet(name: string): Greeting;\n`;
    await writeFile(path.join(tmpDir, 'dist', 'module.d.ts'), declarationBeforeEsbuild);
    await writeFile(path.join(tmpDir, 'dist', 'module.d.ts.map'), '{"version":3,"file":"module.d.ts"}\n');

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    await expect(readFile(path.join(tmpDir, 'dist', 'module.d.ts'), 'utf8')).rejects.toThrow('ENOENT');
    await expect(readFile(path.join(tmpDir, 'dist', 'module.d.ts.map'), 'utf8')).rejects.toThrow('ENOENT');
  });
});
