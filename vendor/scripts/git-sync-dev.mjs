/**
 * git-sync-dev.mjs
 * Version: 1.1.0
 *
 * Syncs the dev branch with origin/main via merge or rebase, after creating
 * a timestamped local backup branch and fetching from origin.
 *
 * Usage:
 *   node scripts/git-sync-dev.mjs --version, -v  Show the script version
 *   node scripts/git-sync-dev.mjs merge
 *   node scripts/git-sync-dev.mjs rebase
 *
 * The script runs only when executed directly. Importing it exposes `main` without side effects.
 */

/* oxlint-disable no-console */

import { execFileSync } from 'node:child_process';
import path from 'node:path';

const scriptVersion = '1.1.0';

/**
 * Executes Git with inherited standard input/output.
 *
 * @param {string[]} args Git command arguments.
 * @returns {void}
 */
function git(args) {
  execFileSync('git', args, {
    stdio: 'inherit',
    shell: false,
  });
}

/**
 * Returns a filesystem- and Git-ref-safe local timestamp.
 *
 * @returns {string} Timestamp formatted as YYYYMMDD-HHmmss.
 */
function createTimestamp() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

/**
 * Sync the dev branch with origin/main.
 *
 * @param {string[]} [args] Command line arguments, without the runtime and script paths.
 * @returns {number} The exit code.
 */
export function main(args = process.argv.slice(2)) {
  if (args.includes('--version') || args.includes('-v')) {
    console.log(scriptVersion);
    return 0;
  }

  const operation = args[0];

  if (operation !== 'merge' && operation !== 'rebase') {
    throw new Error('Usage: node scripts/git-sync-dev.mjs <merge|rebase>');
  }

  const backupBranch = `dev-backup-${createTimestamp()}`;

  git(['fetch', 'origin']);
  git(['switch', 'dev']);
  git(['branch', backupBranch]);

  console.log(`Created backup branch: ${backupBranch}`);

  if (operation === 'merge') {
    git(['merge', 'origin/main']);
    git(['push', 'origin', 'dev']);
  } else {
    git(['rebase', 'origin/main']);
    git(['push', '--force-with-lease', 'origin', 'dev']);
  }
  return 0;
}

// `import.meta.main` needs Node.js 22.18 or 24.2; older runtimes fall back to comparing the executed script path.
if (import.meta.main ?? path.resolve(process.argv[1] ?? '') === import.meta.filename) process.exitCode = main();
