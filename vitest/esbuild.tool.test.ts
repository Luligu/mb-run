/**
 * @file vitest/esbuild.tool.test.ts
 * @description Integration test that runs the real esbuild tool (not mocked) against a minimal
 * on-disk project shaped like this repository: a `module.ts` main entry and a bin launcher that
 * imports the package's own compiled main entry by relative path, exactly like `bin/mb-run` does.
 * @author Luca Liguori
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runEsbuild } from '../src/esbuild.js';
import { initLogger } from '../src/logger.js';

let tmpDir: string;

describe('esbuild (real tool)', () => {
  beforeEach(async () => {
    initLogger({ dryRun: false, verbose: false, rootDir: '' });
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-esbuild-tool-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('bundles a launcher that imports its own compiled main entry into a shared chunk, without duplicating the code', async () => {
    // A unique marker so we can tell whether the module's code was inlined once (shared via a
    // chunk) or twice (duplicated into both the main entry output and the bin launcher output).
    const marker = 'MB_RUN_ESBUILD_TOOL_TEST_MARKER_1a2b3c4d5e6f';

    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'sample-tool',
        version: '1.0.0',
        type: 'module',
        main: './dist/module.js',
        exports: { '.': { import: './dist/module.js' } },
        bin: { 'sample-tool': 'bin/sample-tool' },
      }),
    );

    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(path.join(tmpDir, 'src', 'module.ts'), `export function main(): string {\n  return '${marker}';\n}\n`);

    // A JS launcher outside dist, importing the package's own compiled main entry by relative
    // path — the same shape as this repo's bin/mb-run, which triggered the original bug where
    // the two entries were built separately and the launcher duplicated the module's code.
    await mkdir(path.join(tmpDir, 'bin'), { recursive: true });
    await writeFile(path.join(tmpDir, 'bin', 'sample-tool'), `#!/usr/bin/env node\nimport { main } from '../dist/module.js';\nconsole.log(main());\n`);

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    const modulePath = path.join(tmpDir, 'dist', 'module.js');
    const binPath = path.join(tmpDir, 'dist', 'bin', 'sample-tool.js');
    const moduleOutput = await readFile(modulePath, 'utf8');
    const binOutput = await readFile(binPath, 'utf8');

    // A resolve plugin redirects the launcher's `../dist/module.js` import to the same
    // TypeScript source the main entry compiles from, so both entries share one compiled
    // module: neither output file carries the marker's defining code directly.
    expect(moduleOutput).not.toContain(marker);
    expect(binOutput).not.toContain(marker);

    // Instead, exactly one shared chunk holds it, imported by both entries.
    const distEntries = await readdir(path.join(tmpDir, 'dist'), { recursive: true });
    const chunkEntries = distEntries.filter((entry) => entry.includes('chunk-'));
    expect(chunkEntries).toHaveLength(1);
    const chunkOutput = await readFile(path.join(tmpDir, 'dist', chunkEntries[0]), 'utf8');
    expect(chunkOutput).toContain(marker);
    expect(moduleOutput).toContain(chunkEntries[0]);
    expect(binOutput).toContain(chunkEntries[0]);
  });

  it('only redirects a `.js`-suffixed import resolving under dist/ to an existing TypeScript source, falling through otherwise', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'sample-tool',
        version: '1.0.0',
        type: 'module',
        main: './dist/module.js',
        bin: { 'sample-tool': 'bin/sample-tool' },
      }),
    );

    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(path.join(tmpDir, 'src', 'module.ts'), `export function main(): string {\n  return 'main';\n}\n`);
    // A real file imported by a non-'.js' specifier — the plugin must skip it (return early)
    // and leave it to esbuild's own resolution rather than computing a dist/ redirect for it.
    await writeFile(path.join(tmpDir, 'src', 'other.ts'), `export const other = 'OTHER_MARKER';\n`);

    // A leftover compiled file under dist/ with no matching TypeScript source — the plugin's
    // fileExists check must fail and fall through to esbuild's default resolution, which
    // reads this file directly (duplicating it) instead of throwing.
    await mkdir(path.join(tmpDir, 'dist'), { recursive: true });
    await writeFile(path.join(tmpDir, 'dist', 'missing.js'), `export const missing = 'MISSING_MARKER';\n`);

    await mkdir(path.join(tmpDir, 'bin'), { recursive: true });
    await writeFile(
      path.join(tmpDir, 'bin', 'sample-tool'),
      `#!/usr/bin/env node\nimport { main } from '../dist/module.js';\nimport { other } from '../src/other.ts';\nimport { missing } from '../dist/missing.js';\nconsole.log(main(), other, missing);\n`,
    );

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    const binOutput = await readFile(path.join(tmpDir, 'dist', 'bin', 'sample-tool.js'), 'utf8');
    expect(binOutput).toContain('OTHER_MARKER');
    expect(binOutput).toContain('MISSING_MARKER');
  });

  it('deletes leftover per-file compiled JavaScript that this run superseded, while keeping declaration files', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'sample-tool',
        version: '1.0.0',
        type: 'module',
        main: './dist/module.js',
      }),
    );

    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(path.join(tmpDir, 'src', 'helper.ts'), `export function helper(): string {\n  return 'helper';\n}\n`);
    await writeFile(path.join(tmpDir, 'src', 'module.ts'), `import { helper } from './helper.js';\n\nexport function main(): string {\n  return helper();\n}\n`);

    // Simulate a plain `tsc` build that ran before esbuild: one leftover per-file compiled
    // module (helper.js, inlined into module.js's own bundle rather than a standalone output)
    // and its declaration files, which must survive since esbuild does not produce them.
    await mkdir(path.join(tmpDir, 'dist'), { recursive: true });
    await writeFile(path.join(tmpDir, 'dist', 'helper.js'), `export function helper() {\n  return 'helper';\n}\n`);
    await writeFile(path.join(tmpDir, 'dist', 'helper.d.ts'), `export declare function helper(): string;\n`);
    await writeFile(path.join(tmpDir, 'dist', 'helper.d.ts.map'), `{"version":3,"file":"helper.d.ts"}\n`);

    // A leftover subdirectory holding only prunable files (no esbuild output, copyEntries
    // destination, or declaration file survives inside it) — it must end up fully removed,
    // not just emptied.
    await mkdir(path.join(tmpDir, 'dist', 'stale'), { recursive: true });
    await writeFile(path.join(tmpDir, 'dist', 'stale', 'leftover.js'), `export {};\n`);

    await runEsbuild({ rootDir: tmpDir, isWindows: false, dryRun: false });

    const distEntries = await readdir(path.join(tmpDir, 'dist'), { recursive: true });
    expect(distEntries).not.toContain('helper.js');
    expect(distEntries).toContain('helper.d.ts');
    expect(distEntries).toContain('helper.d.ts.map');
    expect(distEntries).toContain('module.js');
    expect(distEntries).not.toContain('stale');
    expect(distEntries).not.toContain(path.join('stale', 'leftover.js'));
  });
});
