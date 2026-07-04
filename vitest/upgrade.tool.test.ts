/**
 * @file vitest/upgrade.tool.test.ts
 * @description This file contains the tests for upgrading tool packages.
 * @author Luca Liguori
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));
vi.mock('../src/cache.js', () => ({ resolveWorkspacePackageJsonPaths: vi.fn().mockResolvedValue([]) }));
vi.mock('../src/clean.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/clean.js')>();
  return { ...actual, emptyDir: vi.fn() };
});
vi.mock('../src/helpers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/helpers.js')>();
  return {
    ...actual,
    isLibrary: vi.fn().mockResolvedValue(false),
    isMonorepo: vi.fn().mockResolvedValue(false),
    isPlugin: vi.fn().mockResolvedValue(false),
  };
});

import { execSync } from 'node:child_process';

import { resolveWorkspacePackageJsonPaths } from '../src/cache.js';
import { emptyDir } from '../src/clean.js';
import { isLibrary, isMonorepo, isPlugin } from '../src/helpers.js';
import { runUpgrade } from '../src/upgrade.js';

let rootDir = '';

async function writeFixture(fileName: string, content: string): Promise<void> {
  const filePath = path.join(rootDir, fileName);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

describe('upgrade tool package', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-upgrade-tool-'));
    await writeFixture(
      'package.json',
      JSON.stringify(
        {
          name: 'upgrade-tool-fixture',
          version: '1.0.0',
          description: 'A fixture for upgrade tests',
          homepage: 'https://example.com',
          type: 'module',
          main: 'dist/module.js',
          types: 'dist/module.d.ts',
          exports: { '.': './dist/module.js' },
          repository: { type: 'git', url: 'https://example.com/upgrade-tool-fixture.git' },
          bugs: { url: 'https://example.com/upgrade-tool-fixture/issues' },
          funding: { type: 'custom', url: 'https://example.com/funding' },
          keywords: ['fixture'],
          engines: { node: '>=20' },
          license: 'Apache-2.0',
          author: 'Fixture Author',
          files: ['dist'],
          automator: { jest: true, vitest: true },
          scripts: { stale: 'echo stale' },
          devDependencies: {
            '@types/node': '0.0.0',
            'jest': '0.0.0',
            'keep': '1.0.0',
            'typescript': '0.0.0',
            'vitest': '0.0.0',
          },
        },
        null,
        2,
      ),
    );
    await writeFixture('.gitignore', 'existing-rule\n');
    await writeFixture('.localignore', 'local-rule\n');
    await writeFixture('.gitlocalignore', 'git-local-rule\n');
    await writeFixture('LICENSE', 'fixture license\n');
    await writeFixture('README.md', 'yellow-button.png src="./bmc-button.svg" src="matterbridge.svg" build-matterbridge-plugin.yml (https://github.com/prettier/prettier)\n');
    await writeFixture(
      'CHANGELOG.md',
      'yellow-button.png https://matterbridge.io/bmc-button.svg src="matterbridge.svg" build-matterbridge-plugin.yml (https://github.com/eslint/eslint)\n',
    );
    for (const fileName of [
      '.prettierignore',
      'eslint.config.js',
      'prettier.config.js',
      'tsconfig.production.json',
      'tsconfig.vitest.json',
      'yellow-button.png',
      'bmc-button.svg',
      'matterbridge.svg',
      'scripts/runAutomator.mjs',
      'scripts/prune-tags.sh',
      'scripts/git-status.sh',
      'scripts/mb-run.mjs',
    ]) {
      await writeFixture(fileName, 'obsolete\n');
    }
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await rm(rootDir, { recursive: true, force: true });
  });

  it('upgrades a normal tool package with Jest and Vitest', async () => {
    await runUpgrade({ rootDir, isWindows: process.platform === 'win32', dryRun: false, enableJest: true, enableVitest: true });

    const packageJson = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    const [gitignore, readme, changelog, tsconfig] = await Promise.all([
      readFile(path.join(rootDir, '.gitignore'), 'utf8'),
      readFile(path.join(rootDir, 'README.md'), 'utf8'),
      readFile(path.join(rootDir, 'CHANGELOG.md'), 'utf8'),
      readFile(path.join(rootDir, 'tsconfig.json'), 'utf8'),
    ]);

    expect(packageJson.devDependencies).toEqual({ keep: '1.0.0' });
    expect(packageJson.scripts).toMatchObject({
      'test': 'cross-env NODE_OPTIONS="--experimental-vm-modules --no-warnings" jest',
      'test:vitest': 'vitest run',
      'test:vitest:coverage': 'vitest run --coverage',
    });
    expect(packageJson.scripts.stale).toBeUndefined();
    expect(gitignore).toContain('local-rule');
    expect(gitignore).toContain('git-local-rule');
    expect(readme).toContain('https://matterbridge.io/assets/bmc-button.svg');
    expect(readme).toContain('https://matterbridge.io/assets/matterbridge.svg');
    expect(readme).toContain('build.yml');
    expect(readme).toContain('(https://prettier.io/)');
    expect(changelog).toContain('https://matterbridge.io/assets/bmc-button.svg');
    expect(changelog).toContain('https://matterbridge.io/assets/matterbridge.svg');
    expect(changelog).toContain('build.yml');
    expect(changelog).toContain('(https://eslint.org/)');
    expect(tsconfig).toContain('"jest"');
    expect(tsconfig).toContain('"vitest/globals"');

    for (const fileName of [
      '.claude/settings.json',
      '.codex/config.toml',
      '.devcontainer/devcontainer.json',
      '.github/workflows/build.yml',
      '.vscode/settings.json',
      'scripts/clean.mjs',
      'jest.config.js',
      'vite.config.ts',
      'tsconfig.base.json',
      'tsconfig.jest.json',
      'tsconfig.build.json',
      'tsconfig.build.production.json',
      'CODE_OF_CONDUCT.md',
      'CODEOWNERS',
      'CONTRIBUTING.md',
      'LICENSE',
      'STYLEGUIDE.md',
    ]) {
      expect(existsSync(path.join(rootDir, fileName))).toBe(true);
    }
    for (const fileName of [
      '.prettierignore',
      'eslint.config.js',
      'prettier.config.js',
      'tsconfig.production.json',
      'tsconfig.vitest.json',
      'yellow-button.png',
      'bmc-button.svg',
      'matterbridge.svg',
      'scripts/runAutomator.mjs',
      'scripts/prune-tags.sh',
      'scripts/git-status.sh',
      'scripts/mb-run.mjs',
    ]) {
      expect(existsSync(path.join(rootDir, fileName))).toBe(false);
    }

    expect(vi.mocked(isPlugin)).toHaveBeenCalledWith(rootDir);
    expect(vi.mocked(isLibrary)).toHaveBeenCalledWith(rootDir);
    expect(vi.mocked(isMonorepo)).toHaveBeenCalledWith(rootDir);
    expect(vi.mocked(resolveWorkspacePackageJsonPaths)).toHaveBeenCalledWith(rootDir);
    expect(vi.mocked(emptyDir)).toHaveBeenCalledWith('node_modules', { rootDir, dryRun: false });
    expect(vi.mocked(execSync)).toHaveBeenCalledWith(expect.stringContaining('npm install'), expect.objectContaining({ cwd: rootDir, stdio: 'inherit' }));
    expect(vi.mocked(execSync)).toHaveBeenCalledWith('npm run build', expect.objectContaining({ cwd: rootDir, stdio: 'inherit' }));
  });
});
