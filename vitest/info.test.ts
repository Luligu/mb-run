/**
 * @file vitest/info.test.ts
 * @description This file contains the tests for the system information utilities.
 * @author Luca Liguori
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getBunVersion, systemInfo } from '../src/info.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => {
    throw new Error('ENOENT');
  }),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

describe('systemInfo', () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('logs exactly 16 lines', () => {
    systemInfo();
    expect(lines).toHaveLength(16);
  });

  it('includes the platform and architecture', () => {
    systemInfo();
    expect(lines[0]).toContain(os.type());
    expect(lines[0]).toContain(os.arch());
  });

  it('includes the kernel release and version', () => {
    systemInfo();
    expect(lines[1]).toContain(os.release());
    expect(lines[1]).toContain(os.version());
  });

  it('includes the hostname', () => {
    systemInfo();
    expect(lines[3]).toContain(os.hostname());
  });

  it('includes the uptime formatted starting with "up"', () => {
    systemInfo();
    expect(lines[4]).toContain('up ');
  });

  it('includes the current year in the date line', () => {
    systemInfo();
    expect(lines[5]).toContain(String(new Date().getFullYear()));
  });

  it('includes memory with "used" and "total" labels', () => {
    systemInfo();
    expect(lines[6]).toContain('used');
    expect(lines[6]).toContain('total');
  });

  it('includes an IPv4 address or "unavailable" in the IPv4 line', () => {
    systemInfo();
    expect(lines[7]).toMatch(/\d+\.\d+\.\d+\.\d+|unavailable/u);
  });

  it('includes IPv6 addresses or "none" in the IPv6 line', () => {
    systemInfo();
    expect(lines[8]).toMatch(/[0-9a-f:]+|none/iu);
  });

  it('includes the Node.js version without a leading v', () => {
    systemInfo();
    const version = process.version.replace(/^v/u, '');
    expect(lines[9]).toContain(version);
    expect(lines[9]).not.toMatch(/v\d/u);
  });

  it('includes an npm version or "unavailable" in the npm line', () => {
    systemInfo();
    expect(lines[10]).toMatch(/\d+\.\d+\.\d+|unavailable/u);
  });

  it('includes unavailable Bun information when Bun is not installed', () => {
    systemInfo();
    expect(lines[11]).toContain('unavailable');
    expect(lines[12]).toContain('unavailable');
    expect(lines[13]).toContain('unavailable');
    expect(lines[14]).toContain('unavailable');
    expect(lines[15]).toContain('unavailable');
  });

  it('returns the trimmed Bun version reported by the Bun executable', () => {
    vi.mocked(execFileSync).mockReturnValue('1.2.3\n');
    expect(getBunVersion()).toBe('1.2.3');
    expect(execFileSync).toHaveBeenCalledWith('bun', ['--version'], expect.any(Object));
  });

  it('returns unavailable when the Bun executable produces empty output', () => {
    vi.mocked(execFileSync).mockReturnValue('');
    expect(getBunVersion()).toBe('unavailable');
  });

  it('includes Bun cache, binary, and global module locations', () => {
    vi.stubEnv('BUN_INSTALL', '/configured/bun');
    vi.stubEnv('BUN_INSTALL_BIN', '/configured/bun/bin');
    vi.stubEnv('BUN_INSTALL_CACHE_DIR', '/configured/bun/cache');
    vi.stubEnv('BUN_INSTALL_GLOBAL_DIR', '/configured/bun/global');
    vi.mocked(execFileSync).mockImplementation((_file, args) => {
      if (args?.includes('cache')) return '/home/user/.bun/install/cache\n';
      if (args?.includes('-g')) return '/home/user/.bun/bin\n';
      return '1.2.3\n';
    });
    systemInfo();
    expect(lines[11]).toContain('1.2.3');
    expect(lines[12]).toContain('/home/user/.bun');
    expect(lines[12]).toContain('(BUN_INSTALL=/configured/bun)');
    expect(lines[13]).toContain('/home/user/.bun/bin');
    expect(lines[13]).toContain('(BUN_INSTALL_BIN=/configured/bun/bin)');
    expect(lines[14]).toContain('/home/user/.bun/install/cache');
    expect(lines[14]).toContain('(BUN_INSTALL_CACHE_DIR=/configured/bun/cache)');
    expect(lines[15]).toContain(path.join('/home/user/.bun', 'install', 'global', 'node_modules'));
    expect(lines[15]).toContain('(BUN_INSTALL_GLOBAL_DIR=/configured/bun/global)');
  });

  it('shows undefined for unset Bun directory environment variables', () => {
    systemInfo();
    expect(lines[12]).toContain('(BUN_INSTALL=undefined)');
    expect(lines[13]).toContain('(BUN_INSTALL_BIN=undefined)');
    expect(lines[14]).toContain('(BUN_INSTALL_CACHE_DIR=undefined)');
    expect(lines[15]).toContain('(BUN_INSTALL_GLOBAL_DIR=undefined)');
  });

  it('memory line shows KB when totalmem is small', () => {
    vi.spyOn(os, 'totalmem').mockReturnValue(512 * 1024);
    vi.spyOn(os, 'freemem').mockReturnValue(256 * 1024);
    systemInfo();
    expect(lines[6]).toContain('KB');
  });

  it('memory line shows MB when totalmem is in the MB range', () => {
    vi.spyOn(os, 'totalmem').mockReturnValue(512 * 1024 * 1024);
    vi.spyOn(os, 'freemem').mockReturnValue(256 * 1024 * 1024);
    systemInfo();
    expect(lines[6]).toContain('MB');
  });

  it('IPv4 line shows "unavailable" when no non-internal interfaces exist', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({});
    systemInfo();
    expect(lines[7]).toContain('unavailable');
  });

  it('handles undefined interface entries in networkInterfaces without throwing', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({ lo: undefined });
    systemInfo();
    expect(lines[7]).toContain('unavailable');
    expect(lines[8]).toContain('none');
  });

  it('IPv6 line shows "none" when no non-internal IPv6 addresses exist', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      lo: [
        {
          family: 'IPv4',
          address: '127.0.0.1',
          internal: true,
          netmask: '255.0.0.0',
          mac: '00:00:00:00:00:00',
          cidr: '127.0.0.1/8',
        },
      ],
    });
    systemInfo();
    expect(lines[8]).toContain('none');
  });

  it('uptime line shows "up less than a minute" when uptime is under 60 seconds', () => {
    vi.spyOn(os, 'uptime').mockReturnValue(30);
    systemInfo();
    expect(lines[4]).toContain('up less than a minute');
  });

  it('uptime line uses singular forms for exactly 1 day, 1 hour, 1 minute', () => {
    vi.spyOn(os, 'uptime').mockReturnValue(86400 + 3600 + 60);
    systemInfo();
    expect(lines[4]).toContain('1 day');
    expect(lines[4]).toContain('1 hour');
    expect(lines[4]).toContain('1 minute');
    expect(lines[4]).not.toContain('days');
    expect(lines[4]).not.toContain('hours');
    expect(lines[4]).not.toContain('minutes');
  });

  it('uptime line uses plural forms for 2 days, 2 hours, 2 minutes', () => {
    vi.spyOn(os, 'uptime').mockReturnValue(2 * 86400 + 2 * 3600 + 2 * 60);
    systemInfo();
    expect(lines[4]).toContain('2 days');
    expect(lines[4]).toContain('2 hours');
    expect(lines[4]).toContain('2 minutes');
  });

  it('npm line shows version from npm_config_user_agent when package.json candidates are absent', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({});
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    // Point execPath to a directory with no npm package.json
    const origExecPath = process.execPath;
    Object.defineProperty(process, 'execPath', {
      value: '/nonexistent-dir/node',
      configurable: true,
    });
    const origEnv = process.env['npm_config_user_agent'];
    process.env['npm_config_user_agent'] = 'npm/9.8.1 node/v20.0.0 linux x64';
    systemInfo();
    expect(lines[10]).toContain('9.8.1');
    process.env['npm_config_user_agent'] = origEnv;
    Object.defineProperty(process, 'execPath', {
      value: origExecPath,
      configurable: true,
    });
  });

  it('npm line shows "unavailable" when agent string does not match the npm/ pattern', () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const origExecPath = process.execPath;
    Object.defineProperty(process, 'execPath', {
      value: '/nonexistent-dir/node',
      configurable: true,
    });
    const origEnv = process.env['npm_config_user_agent'];
    process.env['npm_config_user_agent'] = 'yarn/1.22.0 node/v20.0.0';
    systemInfo();
    expect(lines[10]).toContain('unavailable');
    process.env['npm_config_user_agent'] = origEnv;
    Object.defineProperty(process, 'execPath', {
      value: origExecPath,
      configurable: true,
    });
  });

  it('npm line shows "unavailable" when no npm source is accessible', () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const origExecPath = process.execPath;
    Object.defineProperty(process, 'execPath', {
      value: '/nonexistent-dir/node',
      configurable: true,
    });
    const origEnv = process.env['npm_config_user_agent'];
    delete process.env['npm_config_user_agent'];
    systemInfo();
    expect(lines[10]).toContain('unavailable');
    process.env['npm_config_user_agent'] = origEnv;
    Object.defineProperty(process, 'execPath', {
      value: origExecPath,
      configurable: true,
    });
  });
});
