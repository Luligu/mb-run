/**
 * @file vitest/self.worker.test.ts
 * @description This file contains tests for the mb-run self-update worker.
 * @author Luca Liguori
 */

import { readFile } from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

const postMessageMock = vi.hoisted(() => vi.fn());

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));

vi.mock('node:worker_threads', () => ({
  parentPort: { postMessage: postMessageMock },
  Worker: vi.fn(),
}));

vi.mock('../src/self.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/self.js')>();
  return { isNewerVersion: actual.isNewerVersion };
});

import { runSelfUpdateCheck } from '../src/self.worker.js';

describe('self update worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(readFile).mockReset();
    postMessageMock.mockReset();
  });

  it('should post the current and latest versions when an update exists', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ version: '1.0.0' }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: '2.0.0' }), { status: 200 })));

    await runSelfUpdateCheck();

    expect(postMessageMock).toHaveBeenCalledWith({ currentVersion: '1.0.0', latestVersion: '2.0.0' });
  });

  it('should not post when the installed version is current', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ version: '2.0.0' }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: '2.0.0' }), { status: 200 })));

    await runSelfUpdateCheck();

    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { version: 1 }])('should ignore invalid package data %#', async (packageData) => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(packageData));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await runSelfUpdateCheck();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should ignore unsuccessful registry responses', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ version: '1.0.0' }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await runSelfUpdateCheck();

    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { version: 1 }])('should ignore invalid registry data %#', async (registryData) => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ version: '1.0.0' }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(registryData), { status: 200 })));

    await runSelfUpdateCheck();

    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it('should ignore filesystem and registry failures', async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error('missing'));
    await expect(runSelfUpdateCheck()).resolves.toBeUndefined();

    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ version: '1.0.0' }));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(runSelfUpdateCheck()).resolves.toBeUndefined();
  });
});
