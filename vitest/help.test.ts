import { describe, expect, it, vi } from 'vitest';

import { printUsage, printVersionUsage } from '../src/help.js';

describe('printUsage', () => {
  it('logs the usage message', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printUsage();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('includes the tool name', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printUsage();
    expect(spy.mock.calls[0][0]).toContain('mb-run');
  });

  it('includes all primary flags', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printUsage();
    const output = spy.mock.calls[0][0] as string;
    for (const flag of ['--reset', '--deep-clean', '--clean', '--build', '--test', '--lint', '--format', '--dry-run', '--version', '--verbose']) {
      expect(output).toContain(flag);
    }
  });
});

describe('printVersionUsage', () => {
  it('logs the version usage message', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printVersionUsage();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('includes --version flag and valid tags', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printVersionUsage();
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain('--version');
    for (const tag of ['dev', 'edge', 'git', 'local', 'next', 'alpha', 'beta']) {
      expect(output).toContain(tag);
    }
  });
});
