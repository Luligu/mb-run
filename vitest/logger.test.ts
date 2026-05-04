import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatCommandArg, initLogger, logCommand, logDelete, Logger, logWriteFile } from '../src/logger.js';

describe('formatCommandArg', () => {
  it('wraps an empty string as ""', () => {
    expect(formatCommandArg('')).toBe('""');
  });

  it('returns a plain argument unchanged', () => {
    expect(formatCommandArg('--build')).toBe('--build');
  });

  it('quotes an argument that contains a space', () => {
    expect(formatCommandArg('hello world')).toBe('"hello world"');
  });

  it('quotes an argument that contains a double-quote character', () => {
    expect(formatCommandArg('say "hi"')).toBe('"say \\"hi\\""');
  });
});

describe('Logger', () => {
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

  describe('shouldLogActions', () => {
    it('returns false when both dryRun and verbose are false', () => {
      const logger = new Logger({ dryRun: false, verbose: false, rootDir: '/root' });
      expect(logger.shouldLogActions()).toBe(false);
    });

    it('returns true when dryRun is true', () => {
      const logger = new Logger({ dryRun: true, verbose: false, rootDir: '/root' });
      expect(logger.shouldLogActions()).toBe(true);
    });

    it('returns true when verbose is true', () => {
      const logger = new Logger({ dryRun: false, verbose: true, rootDir: '/root' });
      expect(logger.shouldLogActions()).toBe(true);
    });
  });

  describe('logPrefix', () => {
    it('contains [mb-run]', () => {
      const logger = new Logger({ dryRun: false, verbose: false, rootDir: '/root' });
      expect(logger.logPrefix()).toContain('[mb-run]');
    });

    it('contains [dry] when dryRun is true', () => {
      const logger = new Logger({ dryRun: true, verbose: false, rootDir: '/root' });
      expect(logger.logPrefix()).toContain('[dry]');
    });

    it('does not contain [dry] when dryRun is false', () => {
      const logger = new Logger({ dryRun: false, verbose: false, rootDir: '/root' });
      expect(logger.logPrefix()).not.toContain('[dry]');
    });
  });

  describe('logCommand', () => {
    it('does not log when shouldLogActions is false', () => {
      const logger = new Logger({ dryRun: false, verbose: false, rootDir: '/root' });
      logger.logCommand('node', ['--version']);
      expect(lines).toHaveLength(0);
    });

    it('logs the command and args when verbose is true', () => {
      const logger = new Logger({ dryRun: false, verbose: true, rootDir: '/root' });
      logger.logCommand('node', ['--version']);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('node');
      expect(lines[0]).toContain('--version');
    });

    it('uses rootDir as the default cwd in the log line', () => {
      const logger = new Logger({ dryRun: false, verbose: true, rootDir: '/my/root' });
      logger.logCommand('npm', ['install']);
      expect(lines[0]).toContain('/my/root');
    });

    it('uses the provided cwd when given', () => {
      const logger = new Logger({ dryRun: false, verbose: true, rootDir: '/root' });
      logger.logCommand('npm', ['install'], '/other/dir');
      expect(lines[0]).toContain('/other/dir');
    });

    it('quotes args that contain spaces', () => {
      const logger = new Logger({ dryRun: false, verbose: true, rootDir: '/root' });
      logger.logCommand('echo', ['hello world']);
      expect(lines[0]).toContain('"hello world"');
    });

    it('logs when dryRun is true even if verbose is false', () => {
      const logger = new Logger({ dryRun: true, verbose: false, rootDir: '/root' });
      logger.logCommand('node', ['--version']);
      expect(lines).toHaveLength(1);
    });

    it('works correctly when destructured from the instance (auto-binding)', () => {
      const logger = new Logger({ dryRun: false, verbose: true, rootDir: '/root' });
      const { logCommand } = logger;
      logCommand('git', ['status']);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('git');
      expect(lines[0]).toContain('status');
    });
  });

  describe('logDelete', () => {
    it('does not log when shouldLogActions is false', () => {
      const logger = new Logger({ dryRun: false, verbose: false, rootDir: '/root' });
      logger.logDelete('/some/path/file.txt');
      expect(lines).toHaveLength(0);
    });

    it('logs "delete" and the basename when verbose is true', () => {
      const logger = new Logger({ dryRun: false, verbose: true, rootDir: '/root' });
      logger.logDelete(path.join('/some', 'dir', 'file.txt'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('delete');
      expect(lines[0]).toContain('file.txt');
    });
  });

  describe('logWriteFile', () => {
    it('does not log when shouldLogActions is false', () => {
      const logger = new Logger({ dryRun: false, verbose: false, rootDir: '/root' });
      logger.logWriteFile('/some/path/out.json');
      expect(lines).toHaveLength(0);
    });

    it('logs "write" and the basename when verbose is true', () => {
      const logger = new Logger({ dryRun: false, verbose: true, rootDir: '/root' });
      logger.logWriteFile(path.join('/some', 'dir', 'out.json'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('write');
      expect(lines[0]).toContain('out.json');
    });
  });
});

describe('module-level logger (initLogger + free functions)', () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Reset to silent defaults so other tests are not affected.
    initLogger({ dryRun: false, verbose: false, rootDir: '' });
  });

  it('does not log before initLogger is called with active settings', () => {
    initLogger({ dryRun: false, verbose: false, rootDir: '/root' });
    logCommand('node', ['--version']);
    expect(lines).toHaveLength(0);
  });

  it('logCommand logs when dryRun is true', () => {
    initLogger({ dryRun: true, verbose: false, rootDir: '/root' });
    logCommand('npm', ['install']);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('npm');
    expect(lines[0]).toContain('install');
  });

  it('logCommand logs when verbose is true', () => {
    initLogger({ dryRun: false, verbose: true, rootDir: '/root' });
    logCommand('node', ['--version']);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('node');
  });

  it('logCommand uses cwd when provided', () => {
    initLogger({ dryRun: false, verbose: true, rootDir: '/root' });
    logCommand('node', [], '/custom/cwd');
    expect(lines[0]).toContain('/custom/cwd');
  });

  it('logDelete logs when verbose is true', () => {
    initLogger({ dryRun: false, verbose: true, rootDir: '/root' });
    logDelete(path.join('/some', 'dir', 'file.txt'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('delete');
    expect(lines[0]).toContain('file.txt');
  });

  it('logWriteFile logs when verbose is true', () => {
    initLogger({ dryRun: false, verbose: true, rootDir: '/root' });
    logWriteFile(path.join('/some', 'dir', 'out.json'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('write');
    expect(lines[0]).toContain('out.json');
  });

  it('re-initializing changes the active logger', () => {
    initLogger({ dryRun: false, verbose: true, rootDir: '/root' });
    logCommand('git', ['status']);
    expect(lines).toHaveLength(1);
    lines.length = 0;

    initLogger({ dryRun: false, verbose: false, rootDir: '/root' });
    logCommand('git', ['status']);
    expect(lines).toHaveLength(0);
  });
});
