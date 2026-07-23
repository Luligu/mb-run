/**
 * @file vitest/esbuild.library.test.ts
 * @description Integration test that runs the real esbuild and dts-bundle-generator tools (not
 * mocked) against a minimal on-disk library package, mirroring pack.ts's pipeline order — esbuild
 * first, then declaration bundling — to verify esbuild's dist-pruning step leaves declaration
 * files untouched, and that the later dts bundling step still produces correct output from them.
 * @author Luca Liguori
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runDtsBundle } from '../src/dts.js';
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

  // A trivial smoke check so this file runs as an active test (not just a skipped suite) while
  // the real test below stays disabled; see README.md "Known Issues".
  it('exposes runEsbuild and runDtsBundle as functions', () => {
    expect(typeof runEsbuild).toBe('function');
    expect(typeof runDtsBundle).toBe('function');
  });

  // oxlint-disable-next-line vitest/warn-todo -- tracks the commented-out test below; see README.md "Known Issues"
  it.todo('keeps the declaration file esbuild does not produce, then bundles it with the real dts-bundle-generator (blocked: see README.md "Known Issues")');

  // Commented out: with the currently pinned `typescript@7`, the real (unmocked)
  // dts-bundle-generator call below fails — TypeScript 7's native compiler removed the classic
  // Program API (`ts.sys`, `ts.createProgram`, …) from the package's default entry point, and
  // dts-bundle-generator depends on it. See the "Known Issues" section in README.md for details
  // and tracking links. Re-enable once either dts-bundle-generator ships TS7 support, or this
  // project adopts the `@typescript/typescript6` side-by-side workaround.
  //
  // oxlint-disable-next-line vitest/no-commented-out-tests -- intentionally disabled, not forgotten; see the comment above
  // it('keeps the declaration file esbuild does not produce, then bundles it with the real dts-bundle-generator', async () => {
  //   await writeFile(
  //     path.join(tmpDir, 'tsconfig.json'),
  //     JSON.stringify({
  //       compilerOptions: {
  //         target: 'esnext',
  //         module: 'esnext',
  //         moduleResolution: 'bundler',
  //         declaration: true,
  //         strict: true,
  //         skipLibCheck: true,
  //       },
  //     }),
  //   );
  //
  //   await writeFile(
  //     path.join(tmpDir, 'package.json'),
  //     JSON.stringify({
  //       name: 'sample-library',
  //       version: '1.0.0',
  //       type: 'module',
  //       main: './dist/module.js',
  //       types: './dist/module.d.ts',
  //       exports: { '.': { import: './dist/module.js', types: './dist/module.d.ts' } },
  //     }),
  //   );
  //
  //   await mkdir(path.join(tmpDir, 'src'), { recursive: true });
  //   await writeFile(
  //     path.join(tmpDir, 'src', 'module.ts'),
  //     `export interface Greeting {\n  message: string;\n}\n\nexport function greet(name: string): Greeting {\n  return { message: \`Hello, \${name}!\` };\n}\n`,
  //   );
  //
  //   // Simulate a prior `tsc` production build: per-file compiled JavaScript (which esbuild's
  //   // bundle supersedes and prunes) plus the declaration file and its source map (which esbuild
  //   // does not produce and must leave untouched for the later dts-bundle-generator step).
  //   await mkdir(path.join(tmpDir, 'dist'), { recursive: true });
  //   await writeFile(path.join(tmpDir, 'dist', 'module.js'), `export function greet(name) {\n  return { message: \`Hello, \${name}!\` };\n}\n`);
  //   const declarationBeforeEsbuild = `export interface Greeting {\n  message: string;\n}\nexport declare function greet(name: string): Greeting;\n`;
  //   await writeFile(path.join(tmpDir, 'dist', 'module.d.ts'), declarationBeforeEsbuild);
  //   await writeFile(path.join(tmpDir, 'dist', 'module.d.ts.map'), `{"version":3,"file":"module.d.ts"}\n`);
  //
  //   await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });
  //
  //   // Esbuild must not have touched the declaration file or its map — they are produced by a
  //   // separate step and are unrelated to esbuild's own JavaScript outputs.
  //   await expect(readFile(path.join(tmpDir, 'dist', 'module.d.ts'), 'utf8')).resolves.toBe(declarationBeforeEsbuild);
  //   await expect(readFile(path.join(tmpDir, 'dist', 'module.d.ts.map'), 'utf8')).resolves.toBe('{"version":3,"file":"module.d.ts"}\n');
  //
  //   await runDtsBundle({ rootDir: tmpDir, dryRun: false });
  //
  //   const bundledDeclaration = await readFile(path.join(tmpDir, 'dist', 'module.d.ts'), 'utf8');
  //   expect(bundledDeclaration).toContain('interface Greeting');
  //   expect(bundledDeclaration).toContain('declare function greet');
  // });
});
