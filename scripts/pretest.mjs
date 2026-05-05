/* eslint-disable no-console */

/**
 * Installs dependencies for all vendor fixture repositories before the test
 * suite runs. The sentinel for "already installed" is `.bin/tsc` rather than
 * the node_modules directory itself, so a prior aborted install does not
 * incorrectly skip this step.
 *
 * On a CI runner the workflow only runs `npm ci` at the root, so vendor fixture
 * directories have no node_modules. Tests run against the vendor directories
 * directly (no temp copies) so this script must install their dependencies once,
 * serially, before any test worker starts.
 *
 * vendor/plugin additionally needs matterbridge, which is not declared in its
 * package.json. After installing the plugin deps, this script attempts
 * `npm link matterbridge` and falls back to `npm install matterbridge` when no
 * global link is available (matching the behaviour of the original copyRepo helper).
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(import.meta.url), '..', '..');

for (const vendor of ['tool', 'library', 'monorepo', 'plugin']) {
  const vendorDir = path.join(root, 'vendor', vendor);
  const sentinel = path.join(vendorDir, 'node_modules', '.bin', 'tsc');
  if (existsSync(sentinel)) {
    console.log(`vendor/${vendor}: already installed, skipping`);
  } else {
    console.log(`vendor/${vendor}: running npm ci`);
    execSync('npm ci --no-fund --no-audit', { cwd: vendorDir, stdio: 'inherit' });
    console.log(`vendor/${vendor}: done`);
  }

  if (vendor === 'plugin') {
    const matterbridgePath = path.join(vendorDir, 'node_modules', 'matterbridge');
    if (!existsSync(matterbridgePath)) {
      console.log('vendor/plugin: linking matterbridge');
      try {
        execSync('npm link --no-fund --no-audit matterbridge', { cwd: vendorDir, stdio: 'inherit' });
        console.log('vendor/plugin: linked matterbridge');
      } catch {
        execSync('npm install --no-fund --no-audit matterbridge', { cwd: vendorDir, stdio: 'inherit' });
        console.log('vendor/plugin: installed matterbridge');
      }
      console.log('vendor/plugin: matterbridge ready');
    }
  }
}
