/**
 * @description This file contains action-logging utilities for the mb-run command.
 * @file logger.ts
 * @author Luca Liguori
 * @created 2026-05-02
 * @version 1.0.0
 * @license Apache-2.0
 *
 * Copyright 2026, 2027, 2028 Luca Liguori.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import path from 'node:path';

import { brightRed, brightYellow, cyan, green, log, magenta, reverse } from './ansi.js';

/**
 * Formats a command argument for verbose logging.
 *
 * Wraps empty strings as `""` and quotes arguments containing whitespace or
 * double-quote characters using JSON serialisation.
 *
 * @param {string} arg Argument value.
 * @returns {string} Formatted argument safe for display.
 */
export function formatCommandArg(arg: string): string {
  if (arg === '') return '""';
  return /[\s"]/u.test(arg) ? JSON.stringify(arg) : arg;
}

/**
 * Options for constructing a {@link Logger} instance.
 */
export interface LoggerOptions {
  /** Whether dry-run mode is active. */
  dryRun: boolean;
  /** Whether verbose command logging is active. */
  verbose: boolean;
  /** Repository root directory used as the default working directory. */
  rootDir: string;
}

/**
 * Provides action-logging helpers that are aware of dry-run and verbose state.
 *
 * The three callback methods (`logCommand`, `logDelete`, `logWriteFile`) are
 * defined as arrow-function class properties so they can be passed as
 * callbacks without an explicit `.bind()` call.
 */
export class Logger {
  private readonly dryRun: boolean;
  private readonly verbose: boolean;
  private readonly rootDir: string;

  /**
   * Creates a Logger instance.
   *
   * @param {LoggerOptions} opts Configuration options.
   */
  constructor(opts: LoggerOptions) {
    this.dryRun = opts.dryRun;
    this.verbose = opts.verbose;
    this.rootDir = opts.rootDir;
  }

  /**
   * Returns whether action logging should be printed.
   *
   * @returns {boolean} True when verbose or dry-run mode is active.
   */
  shouldLogActions(): boolean {
    return this.verbose || this.dryRun;
  }

  /**
   * Returns the shared log-line prefix for action messages.
   *
   * @returns {string} Colored prefix string, including `[dry]` when in dry-run mode.
   */
  logPrefix(): string {
    return this.dryRun ? `${green('[mb-run]')} ${reverse(magenta('[dry]'))}` : green('[mb-run]');
  }

  /**
   * Logs a command invocation when verbose or dry-run mode is active.
   *
   * @param {string} command Executable name.
   * @param {string[]} args CLI arguments.
   * @param {string} [cwd] Working directory; defaults to the logger's rootDir.
   * @returns {void}
   */
  logCommand = (command: string, args: string[], cwd: string = this.rootDir): void => {
    if (!this.shouldLogActions()) return;
    const parts = [command, ...args].map(formatCommandArg).join(' ');
    log(`${this.logPrefix()} ${cyan(cwd)}> ${green('run')} ${parts}`);
  };

  /**
   * Logs a file or directory deletion when verbose or dry-run mode is active.
   *
   * @param {string} targetPath Path being removed.
   * @returns {void}
   */
  logDelete = (targetPath: string): void => {
    if (!this.shouldLogActions()) return;
    const resolvedPath = path.resolve(targetPath);
    log(`${this.logPrefix()} ${cyan(path.dirname(resolvedPath))}> ${brightRed('delete')} ${formatCommandArg(path.basename(resolvedPath))}`);
  };

  /**
   * Logs a file write when verbose or dry-run mode is active.
   *
   * @param {string} filePath File being written.
   * @returns {void}
   */
  logWriteFile = (filePath: string): void => {
    if (!this.shouldLogActions()) return;
    const resolvedPath = path.resolve(filePath);
    log(`${this.logPrefix()} ${cyan(path.dirname(resolvedPath))}> ${brightYellow('write')} ${formatCommandArg(path.basename(resolvedPath))}`);
  };

  /**
   * Logs an esbuild invocation when verbose or dry-run mode is active.
   *
   * @param {Array<{ in: string; out: string }>} entryPoints Esbuild entry points.
   * @param {string} [cwd] Working directory; defaults to the logger's rootDir.
   * @returns {void}
   */
  logEsbuild = (entryPoints: Array<{ in: string; out: string }>, cwd: string = this.rootDir): void => {
    if (!this.shouldLogActions()) return;
    const entries = entryPoints.map(({ in: inPath }) => formatCommandArg(inPath)).join(' ');
    log(`${this.logPrefix()} ${cyan(cwd)}> ${magenta('esbuild')} ${entries}`);
  };

  /**
   * Logs a backup operation when verbose or dry-run mode is active.
   *
   * @param {string} dir Directory being backed up.
   * @returns {void}
   */
  logBackup = (dir: string): void => {
    if (!this.shouldLogActions()) return;
    log(`${this.logPrefix()} ${cyan(dir)}> ${brightYellow('backup')}`);
  };

  /**
   * Logs a restore operation when verbose or dry-run mode is active.
   *
   * @param {string} dir Directory being restored.
   * @returns {void}
   */
  logRestore = (dir: string): void => {
    if (!this.shouldLogActions()) return;
    log(`${this.logPrefix()} ${cyan(dir)}> ${brightYellow('restore')}`);
  };

  /**
   * Logs an oxfmt format diagnostic (always shown, regardless of verbose/dry-run state).
   *
   * @param {string} severity Oxfmt severity string (e.g. `'Error'`, `'Warning'`, `'Advice'`).
   * @param {string} filePath File in which the diagnostic was reported.
   * @param {string} message Diagnostic message text.
   * @returns {void}
   */
  logOxFormat = (severity: string, filePath: string, message: string): void => {
    const resolvedPath = path.resolve(filePath);
    const coloredSeverity = severity === 'Error' ? brightRed(severity) : severity === 'Warning' ? brightYellow(severity) : cyan(severity);
    log(`${this.logPrefix()} ${cyan(path.dirname(resolvedPath))}> ${magenta('oxfmt')} ${coloredSeverity} ${formatCommandArg(path.basename(resolvedPath))}: ${message}`);
  };

  /**
   * Logs a file being processed by oxfmt when verbose or dry-run mode is active.
   *
   * @param {string} filePath File being processed.
   * @returns {void}
   */
  logOxFormatFile = (filePath: string): void => {
    if (!this.shouldLogActions()) return;
    const resolvedPath = path.resolve(filePath);
    log(`${this.logPrefix()} ${cyan(path.dirname(resolvedPath))}> ${magenta('oxfmt')} ${formatCommandArg(path.basename(resolvedPath))}`);
  };
}

// Module-level logger instance; initialized with safe defaults until initLogger() is called.
let logger: Logger = new Logger({ dryRun: false, verbose: false, rootDir: '' });

/**
 * Initializes the shared module-level logger.
 *
 * Call this once at startup (e.g. in `main()`) before any operations are performed.
 *
 * @param {LoggerOptions} opts Logger configuration.
 * @returns {void}
 */
export function initLogger(opts: LoggerOptions): void {
  logger = new Logger(opts);
}

/**
 * Logs a command invocation when verbose or dry-run mode is active.
 *
 * @param {string} command Executable name.
 * @param {string[]} args CLI arguments.
 * @param {string} [cwd] Working directory; defaults to the logger's rootDir.
 * @returns {void}
 */
export function logCommand(command: string, args: string[], cwd?: string): void {
  logger.logCommand(command, args, cwd);
}

/**
 * Logs a file or directory deletion when verbose or dry-run mode is active.
 *
 * @param {string} targetPath Path being removed.
 * @returns {void}
 */
export function logDelete(targetPath: string): void {
  logger.logDelete(targetPath);
}

/**
 * Logs a file write when verbose or dry-run mode is active.
 *
 * @param {string} filePath File being written.
 * @returns {void}
 */
export function logWriteFile(filePath: string): void {
  logger.logWriteFile(filePath);
}

/**
 * Logs an esbuild invocation when verbose or dry-run mode is active.
 *
 * @param {Array<{ in: string; out: string }>} entryPoints Esbuild entry points.
 * @param {string} [cwd] Working directory; defaults to the logger's rootDir.
 * @returns {void}
 */
export function logEsbuild(entryPoints: Array<{ in: string; out: string }>, cwd?: string): void {
  logger.logEsbuild(entryPoints, cwd);
}

/**
 * Logs a backup operation when verbose or dry-run mode is active.
 *
 * @param {string} dir Directory being backed up.
 * @returns {void}
 */
export function logBackup(dir: string): void {
  logger.logBackup(dir);
}

/**
 * Logs a restore operation when verbose or dry-run mode is active.
 *
 * @param {string} dir Directory being restored.
 * @returns {void}
 */
export function logRestore(dir: string): void {
  logger.logRestore(dir);
}

/**
 * Logs an oxfmt format diagnostic (always shown, regardless of verbose/dry-run state).
 *
 * @param {string} severity Oxfmt severity string (e.g. `'Error'`, `'Warning'`, `'Advice'`).
 * @param {string} filePath File in which the diagnostic was reported.
 * @param {string} message Diagnostic message text.
 * @returns {void}
 */
export function logOxFormat(severity: string, filePath: string, message: string): void {
  logger.logOxFormat(severity, filePath, message);
}

/**
 * Logs a file being processed by oxfmt when verbose or dry-run mode is active.
 *
 * @param {string} filePath File being processed.
 * @returns {void}
 */
export function logOxFormatFile(filePath: string): void {
  logger.logOxFormatFile(filePath);
}
