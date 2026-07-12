/**
 * @file vitest/self.test.ts
 * @description This file contains tests for the mb-run self-update check.
 * @author Luca Liguori
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const workerMock = vi.hoisted(() => ({
  listeners: new Map<string, (message: unknown) => void>(),
  unref: vi.fn(),
}));

vi.mock('node:worker_threads', () => ({
  Worker: class {
    constructor() {
      workerMock.listeners.clear();
    }

    unref(): void {
      workerMock.unref();
    }

    once(event: string, listener: (message: unknown) => void): this {
      workerMock.listeners.set(event, listener);
      return this;
    }
  },
}));

import { checkLatestVersion, isNewerVersion } from '../src/self.js';

describe('self update check', () => {
  afterEach(() => {
    workerMock.listeners.clear();
    workerMock.unref.mockClear();
    vi.restoreAllMocks();
  });

  it('should identify a newer semantic version', () => {
    expect(isNewerVersion('1.1.0', '1.0.0')).toBe(true);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
  });

  it('should not identify equal, older, or invalid versions as newer', () => {
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false);
    expect(isNewerVersion('invalid', '1.0.0')).toBe(false);
  });

  it('should identify a stable release as newer than its prerelease', () => {
    expect(isNewerVersion('1.0.0', '1.0.0-beta.1')).toBe(true);
  });

  it('should start an unreferenced worker', () => {
    checkLatestVersion();
    expect(workerMock.unref).toHaveBeenCalledOnce();
    expect(workerMock.listeners.has('message')).toBe(true);
    expect(workerMock.listeners.has('error')).toBe(true);
  });

  it('should log a warning when the worker reports a newer version', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    checkLatestVersion();
    workerMock.listeners.get('message')?.({ currentVersion: '1.0.0', latestVersion: '99.0.0' });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('99.0.0'));
  });

  it('should ignore malformed worker messages', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    checkLatestVersion();
    workerMock.listeners.get('message')?.({ latestVersion: 99 });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('should ignore worker messages with non-string versions', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    checkLatestVersion();
    workerMock.listeners.get('message')?.({ currentVersion: 1, latestVersion: '2.0.0' });
    workerMock.listeners.get('message')?.({ currentVersion: '1.0.0', latestVersion: 2 });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('should ignore worker errors', () => {
    checkLatestVersion();
    expect(() => workerMock.listeners.get('error')?.(new Error('worker failed'))).not.toThrow();
  });
});
