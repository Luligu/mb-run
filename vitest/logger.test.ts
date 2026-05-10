import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatCommandArg, initLogger, logBackup, logCommand, logDelete, logEsbuild, Logger, logOxFormat, logOxFormatFile, logRestore, logWriteFile } from '../src/logger.js';

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

  describe('logEsbuild', () => {
    it('does not log when shouldLogActions is false', () => {
      const logger = new Logger({ dryRun: false, verbose: false, rootDir: '/root' });
      logger.logEsbuild([{ in: 'src/index.ts', out: 'dist/index.js' }]);
      expect(lines).toHaveLength(0);
    });

    it('logs "esbuild" and entry point when verbose is true', () => {
      const logger = new Logger({ dryRun: false, verbose: true, rootDir: '/root' });
      logger.logEsbuild([{ in: 'src/index.ts', out: 'dist/index.js' }]);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('esbuild');
      expect(lines[0]).toContain('src/index.ts');
    });

    it('uses provided cwd instead of rootDir', () => {
      const logger = new Logger({ dryRun: false, verbose: true, rootDir: '/root' });
      logger.logEsbuild([{ in: 'src/a.ts', out: 'dist/a.js' }], '/custom/cwd');
      expect(lines[0]).toContain('/custom/cwd');
    });
  });

  describe('logBackup', () => {
    it('does not log when shouldLogActions is false', () => {
      const logger = new Logger({ dryRun: false, verbose: false, rootDir: '/root' });
      logger.logBackup('/some/dir');
      expect(lines).toHaveLength(0);
    });

    it('logs "backup" and the dir when verbose is true', () => {
      const logger = new Logger({ dryRun: false, verbose: true, rootDir: '/root' });
      logger.logBackup('/some/dir');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('backup');
      expect(lines[0]).toContain('/some/dir');
    });
  });

  describe('logRestore', () => {
    it('does not log when shouldLogActions is false', () => {
      const logger = new Logger({ dryRun: false, verbose: false, rootDir: '/root' });
      logger.logRestore('/some/dir');
      expect(lines).toHaveLength(0);
    });

    it('logs "restore" and the dir when verbose is true', () => {
      const logger = new Logger({ dryRun: false, verbose: true, rootDir: '/root' });
      logger.logRestore('/some/dir');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('restore');
      expect(lines[0]).toContain('/some/dir');
    });
  });

  describe('logOxFormat', () => {
    it('always logs regardless of verbose/dryRun state', () => {
      const logger = new Logger({ dryRun: false, verbose: false, rootDir: '/root' });
      logger.logOxFormat('Error', path.join('/some', 'dir', 'file.ts'), 'unexpected token');
      expect(lines).toHaveLength(1);
    });

    it('contains "oxfmt", the file name, and the message', () => {
      const logger = new Logger({ dryRun: false, verbose: false, rootDir: '/root' });
      logger.logOxFormat('Error', path.join('/some', 'dir', 'file.ts'), 'unexpected token');
      expect(lines[0]).toContain('oxfmt');
      expect(lines[0]).toContain('file.ts');
      expect(lines[0]).toContain('unexpected token');
    });

    it('includes the severity in the output', () => {
      const logger = new Logger({ dryRun: false, verbose: false, rootDir: '/root' });
      logger.logOxFormat('Warning', path.join('/some', 'dir', 'file.ts'), 'trailing comma');
      expect(lines[0]).toContain('Warning');
    });

    it('also logs when verbose is true', () => {
      const logger = new Logger({ dryRun: false, verbose: true, rootDir: '/root' });
      logger.logOxFormat('Advice', path.join('/some', 'dir', 'file.ts'), 'use semicolons');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('Advice');
    });
  });

  describe('logOxFormatFile', () => {
    it('does not log when shouldLogActions is false', () => {
      const logger = new Logger({ dryRun: false, verbose: false, rootDir: '/root' });
      logger.logOxFormatFile(path.join('/some', 'dir', 'file.ts'));
      expect(lines).toHaveLength(0);
    });

    it('logs "oxfmt" and the file name when verbose is true', () => {
      const logger = new Logger({ dryRun: false, verbose: true, rootDir: '/root' });
      logger.logOxFormatFile(path.join('/some', 'dir', 'file.ts'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('oxfmt');
      expect(lines[0]).toContain('file.ts');
    });

    it('logs when dryRun is true even if verbose is false', () => {
      const logger = new Logger({ dryRun: true, verbose: false, rootDir: '/root' });
      logger.logOxFormatFile(path.join('/some', 'dir', 'file.ts'));
      expect(lines).toHaveLength(1);
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

  it('logEsbuild logs when verbose is true', () => {
    initLogger({ dryRun: false, verbose: true, rootDir: '/root' });
    logEsbuild([{ in: 'src/index.ts', out: 'dist/index.js' }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('esbuild');
  });

  it('logEsbuild uses cwd when provided', () => {
    initLogger({ dryRun: false, verbose: true, rootDir: '/root' });
    logEsbuild([{ in: 'src/index.ts', out: 'dist/index.js' }], '/custom/cwd');
    expect(lines[0]).toContain('/custom/cwd');
  });

  it('logBackup logs when verbose is true', () => {
    initLogger({ dryRun: false, verbose: true, rootDir: '/root' });
    logBackup('/some/dir');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('backup');
  });

  it('logRestore logs when verbose is true', () => {
    initLogger({ dryRun: false, verbose: true, rootDir: '/root' });
    logRestore('/some/dir');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('restore');
  });

  it('logOxFormat always logs regardless of verbose/dryRun', () => {
    initLogger({ dryRun: false, verbose: false, rootDir: '/root' });
    logOxFormat('Error', path.join('/some', 'dir', 'file.ts'), 'unexpected token');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('oxfmt');
    expect(lines[0]).toContain('file.ts');
    expect(lines[0]).toContain('unexpected token');
  });

  it('logOxFormatFile does not log when verbose and dryRun are false', () => {
    initLogger({ dryRun: false, verbose: false, rootDir: '/root' });
    logOxFormatFile(path.join('/some', 'dir', 'file.ts'));
    expect(lines).toHaveLength(0);
  });

  it('logOxFormatFile logs when verbose is true', () => {
    initLogger({ dryRun: false, verbose: true, rootDir: '/root' });
    logOxFormatFile(path.join('/some', 'dir', 'file.ts'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('oxfmt');
    expect(lines[0]).toContain('file.ts');
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
