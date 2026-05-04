/* eslint-disable no-console */

/**
 * Installs dependencies for all vendor fixture repositories before the test
 * suite runs. Directories whose node_modules already exist are skipped so the
 * script is a no-op in a local dev environment where vendor repos are already
 * set up.
 *
 * On a CI runner with a cold npm cache each copyRepo call runs npm install in a
 * fresh temp directory, which takes several minutes. Running npm ci for each
 * vendor fixture here — once, serially, before any test worker starts — populates
 * ~/.npm so every subsequent install resolves from cache and completes in seconds,
 * well within the beforeAll hook timeouts.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(import.meta.url), '..', '..');

for (const vendor of ['tool', 'library', 'monorepo', 'plugin']) {
  const vendorDir = path.join(root, 'vendor', vendor);
  if (existsSync(path.join(vendorDir, 'node_modules'))) {
    console.log(`vendor/${vendor}: node_modules exists, skipping`);
    continue;
  }
  console.log(`vendor/${vendor}: running npm ci`);
  execSync('npm ci --no-fund --no-audit', { cwd: vendorDir, stdio: 'inherit' });
  console.log(`vendor/${vendor}: done`);
}
