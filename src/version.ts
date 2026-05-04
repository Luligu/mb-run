/**
 * @description This file contains versioning utilities for the mb-run command.
 * @file version.ts
 * @author Luca Liguori
 * @created 2026-05-01
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

import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { fileExists } from './clean.js';
import { logCommand, logWriteFile } from './logger.js';
import { ExitError, runCommand } from './spawn.js';

/** Context shared by all version operations. */
export interface VersionOptions {
  /** Root directory of the project. */
  rootDir: string;
  /** When true, log but skip file-system writes and command execution. */
  dryRun: boolean;
}

/**
 * Validates and normalizes the version tag.
 *
 * @param {string | undefined} tag Tag.
 * @returns {'dev' | 'edge' | 'git' | 'local' | 'next' | 'alpha' | 'beta'} Normalized tag.
 */
export function parseVersionTag(tag: string | undefined): 'dev' | 'edge' | 'git' | 'local' | 'next' | 'alpha' | 'beta' {
  const normalized = String(tag ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'dev' || normalized === 'edge' || normalized === 'git' || normalized === 'local' || normalized === 'next' || normalized === 'alpha' || normalized === 'beta') {
    return normalized;
  }
  throw new ExitError(1, 'Missing or invalid --version tag (expected dev, edge, git, local, next, alpha, or beta).');
}

/**
 * Formats a Date as yyyymmdd.
 *
 * @param {Date} date Date.
 * @returns {string} yyyymmdd string.
 */
function formatYyyymmdd(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Returns a 7-char git SHA from the current repo.
 *
 * @param {string} cwd Repo root.
 * @returns {string} sha7.
 */
function shortSha7FromGit(cwd: string): string {
  logCommand('git', ['rev-parse', '--short=7', 'HEAD'], cwd);
  const out = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const sha = String(out).trim();
  if (!/^[0-9a-f]{7}$/i.test(sha)) {
    throw new Error(`Unexpected git short SHA output: ${JSON.stringify(sha)}`);
  }
  return sha.toLowerCase();
}

/**
 * Gets the git 7-char SHA, throwing a user-friendly error if unavailable.
 *
 * @param {string} cwd Repo root.
 * @returns {string} sha7.
 */
function getShortSha7(cwd: string): string {
  try {
    return shortSha7FromGit(cwd);
  } catch (err) {
    throw new ExitError(1, `Unable to determine git short SHA. (${err instanceof Error ? err.message : String(err)})`);
  }
}

/**
 * Extracts a base semver x.y.z from a version string.
 *
 * Accepts either a plain version (x.y.z) or a previously tagged version
 * (x.y.z-<tag>-<yyyymmdd>-<7charSha>). In both cases it returns x.y.z.
 *
 * @param {unknown} version Version.
 * @returns {string} Base semver.
 */
function extractBaseSemver(version: unknown): string {
  const trimmed = String(version ?? '').trim();
  const match = /^([0-9]+\.[0-9]+\.[0-9]+)(?:-.+)?$/.exec(trimmed);
  if (!match) {
    throw new ExitError(1, `package.json version must start with plain x.y.z (got: ${JSON.stringify(trimmed)})`);
  }
  return match[1];
}

/**
 * Gets workspace package.json paths from the root package.json workspaces list.
 *
 * Supports explicit paths and simple globs ending in `/*` (e.g. `packages/*`).
 *
 * @param {VersionOptions} opts Version options.
 * @returns {Promise<string[]>} Absolute paths to workspace package.json files.
 */
async function getWorkspacePackageJsonPaths(opts: VersionOptions): Promise<string[]> {
  const rootPackageJsonPath = path.join(opts.rootDir, 'package.json');
  const raw = await readFile(rootPackageJsonPath, 'utf8');

  const rootPkg = JSON.parse(raw);

  const workspacesConfig = rootPkg?.workspaces;
  let patterns: string[] = [];

  if (Array.isArray(workspacesConfig)) {
    patterns = (workspacesConfig as unknown[]).filter((p): p is string => typeof p === 'string');
  } else if (workspacesConfig && typeof workspacesConfig === 'object' && Array.isArray((workspacesConfig as Record<string, unknown>).packages)) {
    patterns = ((workspacesConfig as Record<string, unknown>).packages as unknown[]).filter((p): p is string => typeof p === 'string');
  }

  if (patterns.length === 0) {
    return [];
  }

  // eslint-disable-next-line no-useless-escape
  const hasGlobChars = (s: string): boolean => /[*?\[]/.test(s);

  const packageJsonPaths: string[] = [];

  for (const pattern of patterns) {
    const trimmed = pattern.trim();
    if (!trimmed) continue;

    if (!hasGlobChars(trimmed)) {
      const candidate = path.join(opts.rootDir, trimmed, 'package.json');
      if (await fileExists(candidate)) packageJsonPaths.push(candidate);
      continue;
    }

    // Support only simple "dir/*" style globs.
    // eslint-disable-next-line no-useless-escape
    if (trimmed.endsWith('/*') && trimmed.indexOf('*') === trimmed.length - 1 && !/[?\[]/.test(trimmed)) {
      const baseRel = trimmed.slice(0, -2);
      const baseAbs = path.join(opts.rootDir, baseRel);
      let entries;
      try {
        entries = await readdir(baseAbs, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(baseAbs, entry.name, 'package.json');
        if (await fileExists(candidate)) packageJsonPaths.push(candidate);
      }
      continue;
    }

    throw new ExitError(1, `Unsupported workspaces pattern in root package.json: ${JSON.stringify(trimmed)} (use explicit paths or a simple 'dir/*' glob)`);
  }

  return Array.from(new Set(packageJsonPaths));
}

/**
 * Updates root package.json (and package-lock.json) version.
 *
 * @param {'dev' | 'edge' | 'git' | 'local' | 'next' | 'alpha' | 'beta' | null} tag Tag; null strips suffix.
 * @param {VersionOptions} opts Version options.
 * @returns {Promise<string>} The version that was applied.
 */
export async function updateRootVersion(tag: 'dev' | 'edge' | 'git' | 'local' | 'next' | 'alpha' | 'beta' | null, opts: VersionOptions): Promise<string> {
  const packageJsonPath = path.join(opts.rootDir, 'package.json');
  const raw = await readFile(packageJsonPath, 'utf8');

  const pkg = JSON.parse(raw);

  const currentVersion = pkg.version;
  const baseVersion = extractBaseSemver(currentVersion);
  const nextVersion = tag ? `${baseVersion}-${tag}-${formatYyyymmdd(new Date())}-${getShortSha7(opts.rootDir)}` : baseVersion;

  const workspacesConfig = pkg?.workspaces;

  const hasWorkspaces = Array.isArray(workspacesConfig) || (workspacesConfig && typeof workspacesConfig === 'object' && Array.isArray(workspacesConfig.packages));

  // Use npm so package-lock.json is updated too.
  // Allow same version so re-running can resync package-lock.json or out-of-sync workspace versions.
  // prettier-ignore
  const args = hasWorkspaces
    ? ['version', nextVersion, '--workspaces', '--include-workspace-root', '--no-workspaces-update', '--no-git-tag-version', '--ignore-scripts', '--allow-same-version']
    : ['version', nextVersion, '--no-git-tag-version', '--ignore-scripts', '--allow-same-version'];
  await runCommand('npm', args, { cwd: opts.rootDir, dryRun: opts.dryRun, silent: true });

  return nextVersion;
}

/**
 * Updates inter-workspace dependency ranges to targetVersion.
 *
 * This prevents npm installs from trying to resolve workspace dependencies from
 * the public registry when using prerelease versions.
 *
 * @param {string} targetVersion The version to pin workspace deps to.
 * @param {VersionOptions} opts Version options.
 * @returns {Promise<void>} Resolves when done.
 */
export async function updateWorkspaceDependencyVersions(targetVersion: string, opts: VersionOptions): Promise<void> {
  const packageJsonPaths = await getWorkspacePackageJsonPaths(opts);
  if (packageJsonPaths.length === 0) return;

  const workspacePkgs = await Promise.all(
    packageJsonPaths.map(async (p) => {
      const raw = await readFile(p, 'utf8');

      const pkg = JSON.parse(raw);

      const name = typeof pkg?.name === 'string' ? (pkg.name as string) : null;
      if (!name) {
        throw new ExitError(1, `Workspace package.json missing name: ${p}`);
      }
      return { path: p, name };
    }),
  );

  const workspaceNames = new Set(workspacePkgs.map((p) => p.name));
  const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

  // Include the root package.json so that its references to workspace packages are updated too.
  const rootPackageJsonPath = path.join(opts.rootDir, 'package.json');
  const rootRaw = await readFile(rootPackageJsonPath, 'utf8');
  const rootParsed = JSON.parse(rootRaw) as { name?: string };
  const rootName = typeof rootParsed.name === 'string' ? rootParsed.name : '';
  const pkgsToUpdate = [...workspacePkgs, { path: rootPackageJsonPath, name: rootName }];

  await Promise.all(
    pkgsToUpdate.map(async ({ path: packageJsonPath, name: selfName }) => {
      const raw = await readFile(packageJsonPath, 'utf8');

      const pkg = JSON.parse(raw);
      let changed = false;

      for (const section of sections) {
        const deps = pkg?.[section];
        if (!deps || typeof deps !== 'object') continue;

        for (const depName of Object.keys(deps as Record<string, unknown>)) {
          if (!workspaceNames.has(depName)) continue;
          if (depName === selfName) continue;

          const nextRange = targetVersion;

          if ((deps as Record<string, string>)[depName] !== nextRange) {
            (deps as Record<string, string>)[depName] = nextRange;
            changed = true;
          }
        }
      }

      if (changed) {
        logWriteFile(packageJsonPath);
        if (opts.dryRun) return;
        await writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
      }
    }),
  );
}
