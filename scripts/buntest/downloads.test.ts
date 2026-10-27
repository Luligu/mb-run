/**
 * @file scripts/buntest/downloads.test.ts
 * @description This file contains the tests for downloads.
 * @author Luca Liguori
 */

import { afterAll, afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { main } from '../downloads.mjs';

const log = spyOn(console, 'log').mockImplementation(() => {});
const error = spyOn(console, 'error').mockImplementation(() => {});

let range: unknown;
let status = 200;
// Every request is mocked, so the tests never reach the npm registry.
const fetch = spyOn(globalThis, 'fetch').mockImplementation((async () => new Response(JSON.stringify(range), { status })) as unknown as typeof globalThis.fetch);

let root: string;
let pkgPath: string;

/**
 * Build a range response with the given daily downloads, starting on 2026-09-01.
 *
 * @param {number[]} counts - Downloads of each day.
 * @returns {unknown} The range response.
 */
function rangeOf(counts: number[]): unknown {
  const days = counts.map((downloads, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, downloads }));
  return { start: '2026-09-01', end: days.at(-1)?.day ?? '2026-09-01', package: '@scope/fixture', downloads: days };
}

/**
 * Get everything printed to the console.
 *
 * @returns {string} The printed lines, joined by newlines.
 */
function output(): string {
  return log.mock.calls.map((call) => String(call[0])).join('\n');
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'downloads-test-'));
  pkgPath = path.join(root, 'package.json');
  writeFileSync(pkgPath, JSON.stringify({ name: '@scope/fixture' }));
  range = {
    start: '2026-09-01',
    end: '2026-09-04',
    package: '@scope/fixture',
    downloads: [
      { day: '2026-09-02', downloads: 30 },
      { day: '2026-09-01', downloads: 10 },
      { day: '2026-09-04', downloads: 20 },
      { day: '2026-09-03', downloads: 0 },
    ],
  };
  status = 200;
  setSystemTime(new Date('2026-09-04T12:00:00Z'));
  log.mockClear();
  error.mockClear();
  fetch.mockClear();
});

afterEach(() => {
  setSystemTime();
  rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  log.mockRestore();
  error.mockRestore();
  fetch.mockRestore();
});

describe('downloads.mjs', () => {
  test('should print the version when called with --version or -v', async () => {
    for (const flag of ['--version', '-v']) {
      expect(await main([flag], pkgPath)).toBe(0);
    }
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+$/));
    expect(fetch).not.toHaveBeenCalled();
  });

  test('should print the help when called with --help or -h', async () => {
    for (const flag of ['--help', '-h']) {
      expect(await main([flag], pkgPath)).toBe(0);
    }
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    expect(fetch).not.toHaveBeenCalled();
  });

  test('should not query the npm registry with --dry-run or -n', async () => {
    for (const flag of ['--dry-run', '-n']) {
      expect(await main([flag], pkgPath)).toBe(0);
    }
    expect(log).toHaveBeenCalledWith('[dry-run] Would fetch the npm downloads of @scope/fixture');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('should query an explicit 30-day range and print the sorted days and the summary', async () => {
    expect(await main([], pkgPath)).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('https://api.npmjs.org/downloads/range/2026-08-05:2026-09-04/%40scope%2Ffixture', { headers: { accept: 'application/json' } });
    const text = output();
    expect(text).toContain('npm downloads (last 30 days + today)');
    expect(text).toContain('Package: @scope/fixture');
    expect(text).toContain('Range:   2026-09-01 .. 2026-09-04');
    expect(text.indexOf('2026-09-01')).toBeLessThan(text.indexOf('2026-09-02'));
    expect(text).toMatch(/2026-09-04\s+20/);
    expect(text).toMatch(/Total:\s+60/);
    expect(text).toMatch(/Avg\/day:\s+15/);
    expect(text).toContain('(2026-09-03)');
    expect(text).toContain('(2026-09-02)');
    expect(text).not.toContain('pending');
  });

  test('should mark at most two trailing zero days as pending and leave them out of the summary', async () => {
    range = rangeOf([10, 30, 0, 0]);
    expect(await main([], pkgPath)).toBe(0);
    let text = output();
    expect(text).toMatch(/2026-09-03\s+pending/);
    expect(text).toMatch(/2026-09-04\s+pending/);
    expect(text).toContain('npm has not published the count of 2026-09-03, 2026-09-04 yet');
    expect(text).toMatch(/Total:\s+40/);

    log.mockClear();
    range = rangeOf([10, 0, 0, 0]);
    expect(await main([], pkgPath)).toBe(0);
    text = output();
    expect(text).toMatch(/2026-09-02\s+0/);
    expect(text).toContain('npm has not published the count of 2026-09-03, 2026-09-04 yet');
    expect(text).toContain('Min:      0 (2026-09-02)');
  });

  test('should handle an empty range', async () => {
    range = { start: '2026-08-05', end: '2026-09-04', package: '@scope/fixture', downloads: [] };
    expect(await main([], pkgPath)).toBe(0);
    const text = output();
    expect(text).toContain('Range:   2026-08-05 .. 2026-09-04');
    expect(text).toContain('Min:      0 (-)');
  });

  test('should fail when the package.json is not an object or has no name', async () => {
    writeFileSync(pkgPath, 'null');
    expect(await main([], pkgPath)).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(`Unexpected JSON in ${pkgPath}`));
    writeFileSync(pkgPath, '{}');
    expect(await main([], pkgPath)).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(`Missing/invalid "name" in ${pkgPath}`));
    expect(fetch).not.toHaveBeenCalled();
  });

  test('should fail on an HTTP error, even when its body cannot be read', async () => {
    status = 404;
    expect(await main([], pkgPath)).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('HTTP 404 fetching https://api.npmjs.org/downloads/'));
    fetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => Promise.reject(new Error('closed')) } as unknown as Response);
    expect(await main([], pkgPath)).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('HTTP 500 fetching'));
  });

  test('should fail on an unexpected response shape', async () => {
    range = { downloads: 'none' };
    expect(await main([], pkgPath)).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Unexpected response shape from https://api.npmjs.org/downloads/range/'));
    range = null;
    expect(await main([], pkgPath)).toBe(1);
  });

  test('should report a failure that is not an Error', async () => {
    fetch.mockImplementationOnce((async () => {
      // oxlint-disable-next-line only-throw-error -- Report errors that are not Error instances too
      throw 'offline';
    }) as unknown as typeof globalThis.fetch);
    expect(await main([], pkgPath)).toBe(1);
    expect(error).toHaveBeenCalledWith('offline');
  });
});
