/**
 * @file vitest/install.test.ts
 * @description This file contains tests for package installation utilities.
 * @author Luca Liguori
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/helpers.js', () => ({ isPlugin: vi.fn() }));
vi.mock('../src/spawn.js', () => ({ runCommand: vi.fn() }));

import { isPlugin } from '../src/helpers.js';
import { runInstall } from '../src/install.js';
import { runCommand } from '../src/spawn.js';

describe('runInstall', () => {
  beforeEach(() => {
    vi.mocked(isPlugin).mockReset();
    vi.mocked(runCommand).mockReset();
  });

  it('should install dependencies without linking for a regular package', async () => {
    vi.mocked(isPlugin).mockResolvedValue(false);

    await runInstall({ rootDir: '/project', dryRun: false });

    expect(runCommand).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledWith('npm', ['install', '--no-fund', '--no-audit', '--silent'], { cwd: '/project', dryRun: false });
  });

  it('should link Matterbridge after installing a plugin', async () => {
    vi.mocked(isPlugin).mockResolvedValue(true);

    await runInstall({ rootDir: '/plugin', dryRun: true });

    expect(runCommand).toHaveBeenNthCalledWith(1, 'npm', ['install', '--no-fund', '--no-audit', '--silent'], { cwd: '/plugin', dryRun: true });
    expect(runCommand).toHaveBeenNthCalledWith(2, 'npm', ['link', 'matterbridge', '--no-fund', '--no-audit', '--silent'], {
      cwd: '/plugin',
      dryRun: true,
    });
  });
});
