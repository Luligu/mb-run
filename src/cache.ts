/**
 * @description This file contains in-memory backup and restore utilities for package.json and tsconfig files.
 * @file cache.ts
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

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { fileExists } from './clean.js';
import { logBackup, logRestore } from './logger.js';

/**
 * Maps each package name to its parsed package.json content.
 * Keyed by the `name` field of each package.json.
 */
export const packageJsonMap: Map<string, Record<string, unknown>> = new Map();

/**
 * Maps each tsconfig file to its parsed content.
 * Keyed by the forward-slash relative path from the project root
 * (e.g. `"tsconfig.json"`, `"packages/one/tsconfig.build.json"`).
 */
export const tsconfigMap: Map<string, Record<string, unknown>> = new Map();

/** Maps each package name to its absolute package.json path. Not exported. */
const packageJsonPaths: Map<string, string> = new Map();

/**
 * Resolves the absolute paths to all workspace package.json files.
 * Supports explicit paths and simple `dir/*` globs.
 *
 * @param {string} rootDir Root directory of the project.
 * @returns {Promise<string[]>} Absolute paths to workspace package.json files.
 */
export async function resolveWorkspacePackageJsonPaths(rootDir: string): Promise<string[]> {
  const raw = await readFile(path.join(rootDir, 'package.json'), 'utf8');
  const rootPkg = JSON.parse(raw) as Record<string, unknown>;
  const workspacesConfig = rootPkg.workspaces;

  let patterns: string[] = [];
  if (Array.isArray(workspacesConfig)) {
    patterns = (workspacesConfig as unknown[]).filter((p): p is string => typeof p === 'string');
  } else if (workspacesConfig && typeof workspacesConfig === 'object' && Array.isArray((workspacesConfig as Record<string, unknown>).packages)) {
    patterns = ((workspacesConfig as Record<string, unknown>).packages as unknown[]).filter((p): p is string => typeof p === 'string');
  }

  if (patterns.length === 0) return [];

  // eslint-disable-next-line no-useless-escape
  const hasGlobChars = (s: string): boolean => /[*?\[]/.test(s);
  const results: string[] = [];

  for (const pattern of patterns) {
    const trimmed = pattern.trim();
    if (!trimmed) continue;

    if (!hasGlobChars(trimmed)) {
      const candidate = path.join(rootDir, trimmed, 'package.json');
      if (await fileExists(candidate)) results.push(candidate);
      continue;
    }

    // Support only simple "dir/*" style globs.
    // eslint-disable-next-line no-useless-escape
    if (trimmed.endsWith('/*') && trimmed.indexOf('*') === trimmed.length - 1 && !/[?\[]/.test(trimmed)) {
      const baseAbs = path.join(rootDir, trimmed.slice(0, -2));
      let entries;
      try {
        entries = await readdir(baseAbs, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(baseAbs, entry.name, 'package.json');
        if (await fileExists(candidate)) results.push(candidate);
      }
      continue;
    }
  }

  return Array.from(new Set(results));
}

/**
 * Reads and stores all package.json (root + workspaces) and tsconfig*.json files
 * from the project into memory. Clears any previously cached data before reading.
 *
 * package.json entries are keyed by their `name` field.
 * tsconfig entries are keyed by their forward-slash relative path from `rootDir`.
 *
 * @param {string} rootDir Root directory of the project.
 * @returns {Promise<void>} Resolves when all files have been read into memory.
 */
export async function backup(rootDir: string): Promise<void> {
  logBackup(rootDir);
  packageJsonMap.clear();
  tsconfigMap.clear();
  packageJsonPaths.clear();

  // --- package.json: root ---
  const rootPkgPath = path.join(rootDir, 'package.json');
  const rootPkg = JSON.parse(await readFile(rootPkgPath, 'utf8')) as Record<string, unknown>;
  const rootName = String(rootPkg.name ?? '');
  packageJsonMap.set(rootName, rootPkg);
  packageJsonPaths.set(rootName, rootPkgPath);

  // --- package.json: workspaces ---
  const workspacePkgPaths = await resolveWorkspacePackageJsonPaths(rootDir);
  const workspaceDirs: string[] = [];
  for (const pkgPath of workspacePkgPaths) {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as Record<string, unknown>;
    const name = String(pkg.name ?? '');
    packageJsonMap.set(name, pkg);
    packageJsonPaths.set(name, pkgPath);
    workspaceDirs.push(path.dirname(pkgPath));
  }

  // --- tsconfig*.json: root dir + each workspace dir ---
  const dirsToScan = [rootDir, ...workspaceDirs];
  for (const dir of dirsToScan) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      /* c8 ignore next */
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (!name.startsWith('tsconfig') || !name.endsWith('.json')) continue;
      const absPath = path.join(dir, name);
      const relKey = path.relative(rootDir, absPath).split(path.sep).join('/');
      const parsed = JSON.parse(await readFile(absPath, 'utf8')) as Record<string, unknown>;
      tsconfigMap.set(relKey, parsed);
    }
  }
}

/**
 * Writes all previously backed-up package.json and tsconfig*.json files back to disk.
 * The content written is the exact parsed object stored by `backup`.
 *
 * @param {string} rootDir Root directory of the project.
 * @returns {Promise<void>} Resolves when all files have been written.
 */
export async function restore(rootDir: string): Promise<void> {
  logRestore(rootDir);
  for (const [relKey, content] of tsconfigMap) {
    const absPath = path.join(rootDir, ...relKey.split('/'));
    await writeFile(absPath, JSON.stringify(content, null, 2));
  }
  for (const [name, content] of packageJsonMap) {
    const absPath = packageJsonPaths.get(name);
    if (absPath) {
      await writeFile(absPath, JSON.stringify(content, null, 2));
    }
  }
}
