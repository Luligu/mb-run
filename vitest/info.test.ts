import os from 'node:os';
import process from 'node:process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { systemInfo } from '../src/info.js';

describe('systemInfo', () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs exactly 11 lines', () => {
    systemInfo();
    expect(lines).toHaveLength(11);
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
      lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true, netmask: '255.0.0.0', mac: '00:00:00:00:00:00', cidr: '127.0.0.1/8' }],
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

  it('npm line shows version from npm_config_user_agent when package.json candidates are absent', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({});
    // Point execPath to a directory with no npm package.json
    const origExecPath = process.execPath;
    Object.defineProperty(process, 'execPath', { value: '/nonexistent-dir/node', configurable: true });
    const origEnv = process.env['npm_config_user_agent'];
    process.env['npm_config_user_agent'] = 'npm/9.8.1 node/v20.0.0 linux x64';
    systemInfo();
    expect(lines[10]).toContain('9.8.1');
    process.env['npm_config_user_agent'] = origEnv;
    Object.defineProperty(process, 'execPath', { value: origExecPath, configurable: true });
  });

  it('npm line shows "unavailable" when agent string does not match the npm/ pattern', () => {
    const origExecPath = process.execPath;
    Object.defineProperty(process, 'execPath', { value: '/nonexistent-dir/node', configurable: true });
    const origEnv = process.env['npm_config_user_agent'];
    process.env['npm_config_user_agent'] = 'yarn/1.22.0 node/v20.0.0';
    systemInfo();
    expect(lines[10]).toContain('unavailable');
    process.env['npm_config_user_agent'] = origEnv;
    Object.defineProperty(process, 'execPath', { value: origExecPath, configurable: true });
  });

  it('npm line shows "unavailable" when no npm source is accessible', () => {
    const origExecPath = process.execPath;
    Object.defineProperty(process, 'execPath', { value: '/nonexistent-dir/node', configurable: true });
    const origEnv = process.env['npm_config_user_agent'];
    delete process.env['npm_config_user_agent'];
    systemInfo();
    expect(lines[10]).toContain('unavailable');
    process.env['npm_config_user_agent'] = origEnv;
    Object.defineProperty(process, 'execPath', { value: origExecPath, configurable: true });
  });
});
