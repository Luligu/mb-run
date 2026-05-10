import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initLogger } from '../src/logger.js';
import { runOxFormat } from '../src/oxfmt.js';

// Mock oxfmt so no real formatting happens.
vi.mock('oxfmt', () => ({
  format: vi.fn(),
}));

import { format as mockFormatImport } from 'oxfmt';

const mockFormat = vi.mocked(mockFormatImport);

let tmpDir: string;

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  initLogger({ dryRun: false, verbose: false, rootDir: '' });
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-oxfmt-'));
  // Default: format returns the source unchanged (no writes).
  mockFormat.mockImplementation(async (_file, sourceText) => ({ code: sourceText, errors: [] }));
});

afterEach(async () => {
  vi.restoreAllMocks();
  initLogger({ dryRun: false, verbose: false, rootDir: '' });
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeSource(relPath: string, content = '// stub\n'): Promise<string> {
  const full = path.join(tmpDir, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
  return full;
}

// ---------------------------------------------------------------------------
// dryRun
// ---------------------------------------------------------------------------
describe('runOxFormat — dryRun', () => {
  it('returns early with zero counts when dryRun is true', async () => {
    await writeSource('src/index.ts');
    const result = await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: true });
    expect(result).toEqual({ filesScanned: 0, filesChanged: 0, totalErrors: 0 });
  });

  it('does not call format when dryRun is true', async () => {
    await writeSource('src/index.ts');
    await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: true });
    expect(mockFormat).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// config loading
// ---------------------------------------------------------------------------
describe('runOxFormat — config loading', () => {
  it('uses the default config when .oxfmtrc.json is absent', async () => {
    await writeSource('src/index.ts');
    await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false });
    expect(mockFormat).toHaveBeenCalledOnce();
    const [, , config] = mockFormat.mock.calls[0];
    // Default config sets semi: true
    expect((config as Record<string, unknown>).semi).toBe(true);
  });

  it('loads and applies .oxfmtrc.json when present', async () => {
    const rc = { semi: false, printWidth: 80 };
    await writeFile(path.join(tmpDir, '.oxfmtrc.json'), JSON.stringify(rc), 'utf8');
    await writeSource('src/index.ts');
    await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false });
    // Find the call for index.ts (the rc file is also a .json and will be scanned).
    const call = mockFormat.mock.calls.find(([f]) => String(f).endsWith('index.ts'));
    expect(call).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const config = call![2] as Record<string, unknown>;
    expect(config.semi).toBe(false);
    expect(config.printWidth).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// file collection
// ---------------------------------------------------------------------------
describe('runOxFormat — file collection', () => {
  it('scans supported file extensions', async () => {
    await writeSource('src/a.ts');
    await writeSource('src/b.js');
    await writeSource('src/c.css');
    await writeSource('src/d.md');
    const result = await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false });
    expect(result.filesScanned).toBe(4);
    expect(mockFormat).toHaveBeenCalledTimes(4);
  });

  it('skips files with unsupported extensions', async () => {
    await writeSource('src/a.ts');
    await writeSource('src/b.txt');
    await writeSource('src/c.png');
    const result = await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false });
    expect(result.filesScanned).toBe(1);
  });

  it('skips package-lock.json', async () => {
    await writeSource('package-lock.json');
    await writeSource('src/index.ts');
    const result = await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false });
    expect(result.filesScanned).toBe(1);
  });

  it('skips the node_modules directory', async () => {
    await writeSource('src/index.ts');
    await writeSource('node_modules/some-pkg/index.ts');
    const result = await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false });
    expect(result.filesScanned).toBe(1);
  });

  it('skips the dist directory', async () => {
    await writeSource('src/index.ts');
    await writeSource('dist/module.js');
    const result = await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false });
    expect(result.filesScanned).toBe(1);
  });

  it('skips the coverage directory', async () => {
    await writeSource('src/index.ts');
    await writeSource('coverage/lcov.ts');
    const result = await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false });
    expect(result.filesScanned).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// result counts
// ---------------------------------------------------------------------------
describe('runOxFormat — result counts', () => {
  it('returns filesScanned equal to number of formattable files', async () => {
    await writeSource('src/a.ts');
    await writeSource('src/b.ts');
    const result = await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false });
    expect(result.filesScanned).toBe(2);
  });

  it('returns totalErrors zero when no errors are reported', async () => {
    await writeSource('src/index.ts');
    const result = await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false });
    expect(result.totalErrors).toBe(0);
  });

  it('counts errors returned by format', async () => {
    await writeSource('src/a.ts');
    await writeSource('src/b.ts');
    mockFormat.mockImplementation(async (_file, sourceText) => ({
      code: sourceText,
      // Cast required: oxfmt's Severity is a const enum not assignable from string literals.
      errors: [{ severity: 'Error' as never, message: 'bad syntax', labels: [], helpMessage: null, codeframe: null }],
    }));
    const result = await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false });
    expect(result.totalErrors).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// file writes
// ---------------------------------------------------------------------------
describe('runOxFormat — file writes', () => {
  it('writes back the file when formatted output differs', async () => {
    const original = 'const x=1\n';
    const formatted = 'const x = 1;\n';
    const filePath = await writeSource('src/index.ts', original);
    mockFormat.mockResolvedValue({ code: formatted, errors: [] });

    await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false });

    const written = await readFile(filePath, 'utf8');
    expect(written).toBe(formatted);
  });

  it('does not write the file when formatted output is identical', async () => {
    const content = 'const x = 1;\n';
    const filePath = await writeSource('src/index.ts', content);
    mockFormat.mockResolvedValue({ code: content, errors: [] });

    await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false });

    // File content must still be the original since format returned it unchanged.
    const after = await readFile(filePath, 'utf8');
    expect(after).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// error logging
// ---------------------------------------------------------------------------
describe('runOxFormat — error logging', () => {
  it('logs diagnostics returned by format', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
    initLogger({ dryRun: false, verbose: false, rootDir: tmpDir });

    await writeSource('src/index.ts');
    mockFormat.mockResolvedValue({
      code: '// stub\n',
      // Cast required: oxfmt's Severity is a const enum not assignable from string literals.
      errors: [{ severity: 'Error' as never, message: 'unexpected token', labels: [], helpMessage: null, codeframe: null }],
    });

    await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false });

    expect(lines.some((l) => l.includes('unexpected token'))).toBe(true);
    expect(lines.some((l) => l.includes('index.ts'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verbose logging
// ---------------------------------------------------------------------------
describe('runOxFormat — verbose logging', () => {
  it('logs each file when verbose is true', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
    initLogger({ dryRun: false, verbose: true, rootDir: tmpDir });

    await writeSource('src/index.ts');
    await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false });

    expect(lines.some((l) => l.includes('index.ts'))).toBe(true);
  });

  it('does not log per-file entries when verbose is false and no errors', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
    initLogger({ dryRun: false, verbose: false, rootDir: tmpDir });

    await writeSource('src/index.ts');
    await runOxFormat({ rootDir: tmpDir, isWindows: false, dryRun: false });

    expect(lines).toHaveLength(0);
  });
});
