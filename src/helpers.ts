/**
 * @description This file contains shared helper utilities for the mb-run command.
 * @file helpers.ts
 * @author Luca Liguori
 * @created 2026-05-04
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

import { execFileSync, execSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Reads and parses the package.json file in the given directory.
 *
 * @param {string} rootDir Directory containing the package.json to read.
 * @returns {Promise<Record<string, unknown>>} Parsed package.json content.
 * @throws {Error} If the file cannot be read or contains invalid JSON.
 */
export async function parsePackageJson(rootDir: string): Promise<Record<string, unknown>> {
  const packageJsonPath = path.join(rootDir, 'package.json');
  try {
    const raw = await readFile(packageJsonPath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Failed to read or parse ${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/**
 * Checks if the current package.json scripts indicate we're running in a plugin context.
 *
 * @param {string} rootDir Repository root directory containing the package.json to inspect.
 * @returns {Promise<boolean>} True if we're in a plugin context.
 */
export async function isPlugin(rootDir: string): Promise<boolean> {
  const pkg = (await parsePackageJson(rootDir)) as { scripts?: Record<string, string> };

  return pkg?.scripts?.start === 'matterbridge' || pkg?.scripts?.['dev:link'] === 'npm link --no-fund --no-audit matterbridge';
}

/**
 * Checks if the current package.json defines a monorepo via the workspaces key.
 *
 * @param {string} rootDir Repository root directory containing the package.json to inspect.
 * @returns {Promise<boolean>} True if the package.json has a workspaces field.
 */
export async function isMonorepo(rootDir: string): Promise<boolean> {
  const pkg = await parsePackageJson(rootDir);

  return pkg?.workspaces !== undefined;
}

/** Names and extensions excluded when copying a repository tree with {@link copyRepo}. */
const COPY_REPO_SKIP_NAMES = new Set(['node_modules', 'dist', 'dist-jest', '.cache', 'coverage']);
const COPY_REPO_SKIP_EXTS = ['.tsbuildinfo', '.tgz'];

/** Options for {@link copyRepo}. */
export interface CopyRepoOptions {
  /** When false, skip `npm install` after copying. Defaults to `true`. */
  install?: boolean;
  /** When true, run `npm link matterbridge` after `npm install` (for plugin repos). Defaults to `false`. */
  linkMatterbridge?: boolean;
  /** When true, run `git init` + an initial commit so git-based commands (e.g. `git rev-parse`) work in the copy. Defaults to `false`. */
  gitInit?: boolean;
}

/**
 * Copies a repository source tree to a fresh temp directory, excluding build outputs,
 * node_modules, and generated artefacts, then optionally runs `npm install`.
 *
 * Intended for use in test `beforeAll` hooks to obtain a disposable, isolated copy
 * of a vendor fixture repo so tests never write to the checked-in vendor tree.
 *
 * @param {string} sourceDir Absolute path to the source repository to copy.
 * @param {CopyRepoOptions} [opts] Copy options.
 * @returns {Promise<string>} Absolute path to the new temp directory.
 */
export async function copyRepo(sourceDir: string, opts: CopyRepoOptions = {}): Promise<string> {
  const { install = true, linkMatterbridge = false, gitInit = false } = opts;

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-repo-'));

  /**
   * Recursively copies src into dest, respecting the skip lists.
   *
   * @param {string} src Source directory.
   * @param {string} dest Destination directory.
   * @returns {Promise<void>} Resolves when done.
   */
  async function copyDir(src: string, dest: string): Promise<void> {
    const entries = await readdir(src, { withFileTypes: true });
    await mkdir(dest, { recursive: true });
    for (const entry of entries) {
      const base = entry.name;
      if (COPY_REPO_SKIP_NAMES.has(base)) continue;
      if (COPY_REPO_SKIP_EXTS.some((ext) => base.endsWith(ext))) continue;
      const srcPath = path.join(src, base);
      const destPath = path.join(dest, base);
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
      } else if (entry.isFile()) {
        await copyFile(srcPath, destPath);
      }
    }
  }

  await copyDir(sourceDir, tmpDir);

  if (install) {
    execSync('npm install --no-fund --no-audit', { cwd: tmpDir, stdio: 'inherit' });
  }

  if (linkMatterbridge) {
    try {
      execSync('npm link --no-fund --no-audit matterbridge', { cwd: tmpDir, stdio: 'inherit' });
    } catch {
      execSync('npm install --no-fund --no-audit matterbridge', { cwd: tmpDir, stdio: 'inherit' });
    }
  }

  if (gitInit) {
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: 'mb-run',
      GIT_AUTHOR_EMAIL: 'mb-run@localhost',
      GIT_COMMITTER_NAME: 'mb-run',
      GIT_COMMITTER_EMAIL: 'mb-run@localhost',
    };
    const execOpts = { cwd: tmpDir, stdio: 'ignore' as const, env: gitEnv };
    execFileSync('git', ['init'], execOpts);
    execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], execOpts);
    execFileSync('git', ['add', '-A'], execOpts);
    execFileSync('git', ['commit', '--no-verify', '-m', 'init'], execOpts);
  }

  return tmpDir;
}
