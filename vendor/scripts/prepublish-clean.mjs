/**
 * prepublish-clean.mjs
 * Version: 1.2.0
 *
 * Dependency-free replacement for:
 *   npx shx rm -rf node_modules/* node_modules/.[!.]* node_modules/..?* package-lock.json npm-shrinkwrap.json
 *
 * Empties the contents of node_modules (including dotfiles) while keeping the directory,
 * then removes the lock files.
 *
 * With `--workspaces`, it first cleans the root directory and then cleans every
 * workspace listed in the root package.json `workspaces` array. Simple workspace
 * globs ending in `/*` (for example `packages/*` and `apps/*`) are expanded to
 * concrete child directories that contain a package.json.
 *
 * Usage:
 *   node scripts/prepublish-clean.mjs --version, -v  Show the script version
 *   node scripts/prepublish-clean.mjs
 *   node scripts/prepublish-clean.mjs --workspaces
 *
 * The script runs only when executed directly. Importing it exposes `main` without side effects.
 */

/* oxlint-disable no-console */

import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const scriptVersion = '1.2.0';

// `maxRetries` lets Node retry the EPERM/EBUSY errors Windows raises when a node_modules
// binary is read-only or briefly locked (antivirus, file indexer, an open handle). A lock held
// by a running process (e.g. an LSP with a native .node addon mapped) cannot be retried away,
// so warn and continue instead of aborting the whole clean.
/**
 * Remove a generated path.
 *
 * @param {string} dir Parent directory.
 * @param {string} target Relative path to remove.
 * @returns {void}
 */
const rm = (dir, target) => {
  try {
    rmSync(path.resolve(dir, target), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (caughtError) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node filesystem operations throw system errors.
    const error = /** @type {NodeJS.ErrnoException} */ (caughtError);
    if (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'ENOTEMPTY') {
      console.warn(`Skipped locked path (${error.code}): ${error.path ?? target} — likely held by a running process.`);
      return;
    }
    throw error;
  }
};

/**
 * Clean dependencies and lock files.
 *
 * @param {string} dir Directory to clean.
 * @returns {void}
 */
const clean = (dir) => {
  // Empty the contents (including dotfiles) of node_modules but keep the directory itself.
  try {
    for (const entry of readdirSync(path.resolve(dir, 'node_modules'))) {
      rm(path.resolve(dir, 'node_modules'), entry);
    }
  } catch {
    // node_modules does not exist, nothing to empty.
  }

  // Fully remove the lock files.
  rm(dir, 'package-lock.json');
  rm(dir, 'npm-shrinkwrap.json');
};

/**
 * Collect the workspace directories listed in the root package.json that contain a package.json.
 *
 * @param {string} root Root directory containing the package.json.
 * @returns {string[]} The absolute paths of the workspace directories.
 */
const getWorkspaceDirs = (root) => {
  const { workspaces = [] } = JSON.parse(readFileSync(path.resolve(root, 'package.json'), 'utf8'));
  const patterns = Array.isArray(workspaces) ? workspaces : (workspaces.packages ?? []);
  const dirs = [];

  for (const pattern of patterns) {
    if (!pattern.endsWith('/*')) {
      const dir = path.resolve(root, pattern);
      if (existsSync(path.resolve(dir, 'package.json'))) dirs.push(dir);
      continue;
    }

    const parentDir = path.resolve(root, pattern.slice(0, -2));
    let entries;
    try {
      entries = readdirSync(parentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.resolve(parentDir, entry.name);
      if (existsSync(path.resolve(dir, 'package.json'))) dirs.push(dir);
    }
  }

  return dirs;
};

/**
 * Run the prepublish clean.
 *
 * @param {string[]} [args] Command line arguments, without the runtime and script paths.
 * @param {string} [root] Directory to clean.
 * @returns {number} The exit code.
 */
export const main = (args = process.argv.slice(2), root = process.cwd()) => {
  if (args.includes('--version') || args.includes('-v')) {
    console.log(scriptVersion);
    return 0;
  }

  clean(root);

  if (args.includes('--workspaces')) {
    for (const workspaceDir of getWorkspaceDirs(root)) {
      clean(workspaceDir);
    }
  }
  return 0;
};

// `import.meta.main` needs Node.js 22.18 or 24.2; older runtimes fall back to comparing the executed script path.
if (import.meta.main ?? path.resolve(process.argv[1] ?? '') === import.meta.filename) process.exitCode = main();
