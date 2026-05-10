/**
 * @description This file contains oxfmt formatting utilities for the mb-run command.
 * @file oxfmt.ts
 * @author Luca Liguori
 * @created 2026-05-10
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

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { format, type FormatConfig } from 'oxfmt';

import { fileExists } from './clean.js';
import { logOxFormatError, logOxFormatFile, logWriteFile } from './logger.js';

/** Context shared by all oxformat operations. */
export interface OxFormatOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** True when running on Windows. */
  isWindows: boolean;
  /** When true, log but skip command execution and file-system writes. */
  dryRun: boolean;
}

/** File extensions that oxfmt can format. */
const FORMATTABLE_EXTENSIONS = new Set([
  '.astro',
  '.cjs',
  '.cts',
  '.css',
  '.html',
  '.js',
  '.jsonc',
  '.json',
  '.jsx',
  '.md',
  '.mdx',
  '.mjs',
  '.mts',
  '.svelte',
  '.ts',
  '.tsx',
  '.vue',
]);

/** Directory names to skip when walking the file tree. */
const SKIP_DIRS = new Set(['.cache', '.git', 'apps', 'build', 'chip', 'coverage', 'dist', 'node_modules', 'temp', 'vendor']);

/** File names to skip when walking the file tree. */
const SKIP_FILES = new Set(['package-lock.json']);

/**
 * Recursively collects all formattable file paths under the given directory,
 * skipping {@link SKIP_DIRS} directories and {@link SKIP_FILES} files.
 *
 * @param {string} dir Absolute path to the directory to walk.
 * @returns {Promise<string[]>} Resolves with all matching file paths.
 */
async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        result.push(...(await collectFiles(full)));
      }
    } else if (FORMATTABLE_EXTENSIONS.has(path.extname(entry.name)) && !SKIP_FILES.has(entry.name)) {
      result.push(full);
    }
  }
  return result;
}

/** Result returned by {@link runOxFormat}. */
export interface OxFormatResult {
  /** Total number of files scanned. */
  filesScanned: number;
  /** Total number of files whose content was changed. */
  filesChanged: number;
  /** Total number of format errors across all files. */
  totalErrors: number;
}

/**
 * Formats all source files in the project using the oxfmt JavaScript API.
 *
 * When `.oxfmtrc.json` is present in `opts.rootDir`, its content is loaded and
 * used as the format configuration for every file.  Files under {@link SKIP_DIRS}
 * directories are skipped.  Any format error reported by oxfmt is logged but
 * does not abort the run; only files whose formatted output differs from the
 * original are written back to disk.
 *
 * @param {OxFormatOptions} opts OxFormat options.
 * @returns {Promise<OxFormatResult>} Resolves with the total files scanned and total errors.
 */
export async function runOxFormat(opts: OxFormatOptions): Promise<OxFormatResult> {
  if (opts.dryRun) return { filesScanned: 0, filesChanged: 0, totalErrors: 0 };

  let config: FormatConfig = {
    printWidth: 180,
    tabWidth: 2,
    useTabs: false,
    semi: true,
    singleQuote: true,
    quoteProps: 'consistent',
    jsxSingleQuote: false,
    trailingComma: 'all',
    bracketSpacing: true,
    bracketSameLine: false,
    arrowParens: 'always',
    requirePragma: false,
    insertPragma: false,
    proseWrap: 'preserve',
    endOfLine: 'lf',
    embeddedLanguageFormatting: 'auto',
    singleAttributePerLine: false,
    sortImports: {
      groups: ['side_effect', 'builtin', 'external', ['internal', 'subpath'], ['parent', 'sibling', 'index'], 'style', 'unknown'],
    },
    sortPackageJson: false,
  };
  const configPath = path.join(opts.rootDir, '.oxfmtrc.json');
  if (await fileExists(configPath)) {
    const raw = await readFile(configPath, 'utf8');
    config = JSON.parse(raw) as FormatConfig;
  }

  const files = await collectFiles(opts.rootDir);
  const results = await Promise.all(
    files.map(async (filePath) => {
      const sourceText = await readFile(filePath, 'utf8');
      logOxFormatFile(filePath);
      const result = await format(filePath, sourceText, config);
      if (result.errors.length > 0) {
        for (const err of result.errors) {
          logOxFormatError(err.severity, filePath, err.message);
        }
      }
      let changed = 0;
      if (result.code !== sourceText) {
        changed = 1;
        logWriteFile(filePath);
        await writeFile(filePath, result.code, 'utf8');
      }
      return { errors: result.errors.length, changed };
    }),
  );

  return {
    filesScanned: files.length,
    filesChanged: results.reduce((sum, r) => sum + r.changed, 0),
    totalErrors: results.reduce((sum, r) => sum + r.errors, 0),
  };
}
