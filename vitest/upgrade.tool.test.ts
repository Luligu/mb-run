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
    await writeFixture('.agents/testing.md', 'obsolete\n');
    await writeFixture('.claude/rules/testing/unit-tests.instructions.md', 'obsolete\n');
    await writeFixture('.github/instructions/testing/unit-tests.instructions.md', 'obsolete\n');
    await writeFixture('.devcontainer/devcontainer.json', 'obsolete\n');
    await writeFixture('.devcontainer/postCreateCommand.sh', 'obsolete\n');
    await writeFixture('.devcontainer/postStartCommand.sh', 'obsolete\n');
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
    const [gitignore, readme, changelog, tsconfig, agents] = await Promise.all([
      readFile(path.join(rootDir, '.gitignore'), 'utf8'),
      readFile(path.join(rootDir, 'README.md'), 'utf8'),
      readFile(path.join(rootDir, 'CHANGELOG.md'), 'utf8'),
      readFile(path.join(rootDir, 'tsconfig.json'), 'utf8'),
      readFile(path.join(rootDir, 'AGENTS.md'), 'utf8'),
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
    expect(agents).toContain('.agents/rules/testing.instructions.md');
    expect(agents).not.toContain('.agents/rules/matterbridge.instructions.md');

    for (const fileName of [
      '.agents/README.md',
      '.agents/rules/testing.instructions.md',
      '.agents/skills/verify-agent-context/SKILL.md',
      '.antigravity/settings.json',
      '.claude/settings.json',
      '.claude/rules/testing/testing.instructions.md',
      '.claude/skills/verify-agent-context/SKILL.md',
      '.codex/config.toml',
      '.devcontainer/bun/devcontainer.json',
      '.devcontainer/node/devcontainer.json',
      '.github/workflows/build.yml',
      '.github/instructions/testing/testing.instructions.md',
      '.github/skills/verify-agent-context/SKILL.md',
      'AGENTS.md',
      'CLAUDE.md',
      'GEMINI.md',
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
      '.agents/testing.md',
      '.claude/rules/testing/unit-tests.instructions.md',
      '.github/instructions/testing/unit-tests.instructions.md',
      '.agents/rules/matterbridge.instructions.md',
      '.agents/rules/plugin-frontend.instructions.md',
      '.agents/rules/chip-tests.instructions.md',
      '.claude/rules/matterbridge/matterbridge.instructions.md',
      '.github/instructions/matterbridge/matterbridge.instructions.md',
      '.devcontainer/devcontainer.json',
      '.devcontainer/postCreateCommand.sh',
      '.devcontainer/postStartCommand.sh',
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
    expect(vi.mocked(execSync)).toHaveBeenCalledWith(expect.stringContaining('npm install'), expect.objectContaining({ cwd: rootDir, stdio: 'inherit' }));
    expect(vi.mocked(execSync)).toHaveBeenCalledWith('npm run build', expect.objectContaining({ cwd: rootDir, stdio: 'inherit' }));
  });

  it('keeps a monorepo that is not matterbridge on the plain rules', async () => {
    vi.mocked(isMonorepo).mockResolvedValue(true);

    await runUpgrade({ rootDir, isWindows: process.platform === 'win32', dryRun: false, enableJest: false, enableVitest: true });

    const agents = await readFile(path.join(rootDir, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('.agents/rules/testing.instructions.md');
    expect(agents).not.toContain('.agents/rules/matterbridge.instructions.md');

    for (const fileName of [
      '.agents/rules/matterbridge.instructions.md',
      '.agents/rules/plugin-frontend.instructions.md',
      '.agents/rules/chip-tests.instructions.md',
      '.claude/rules/matterbridge/matterbridge.instructions.md',
      '.github/instructions/matterbridge/matterbridge.instructions.md',
    ]) {
      expect(existsSync(path.join(rootDir, fileName))).toBe(false);
    }
    expect(existsSync(path.join(rootDir, '.agents/rules/testing.instructions.md'))).toBe(true);

    // The workflows come from the plain .github template, not from .github-plugin
    const [build, publish] = await Promise.all([
      readFile(path.join(rootDir, '.github/workflows/build.yml'), 'utf8'),
      readFile(path.join(rootDir, '.github/workflows/publish.yml'), 'utf8'),
    ]);
    expect(build).not.toContain('(plugin)');
    expect(publish).not.toContain('(plugin)');
  });

  it('removes the publish workflow when automator.skipPublishWorkflow is set', async () => {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { automator: Record<string, unknown> };
    pkg.automator = { ...pkg.automator, skipPublishWorkflow: true };
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');

    await runUpgrade({ rootDir, isWindows: process.platform === 'win32', dryRun: false, enableJest: false, enableVitest: true });

    expect(existsSync(path.join(rootDir, '.github/workflows/publish.yml'))).toBe(false);
    // The rest of .github still lands
    expect(existsSync(path.join(rootDir, '.github/workflows/build.yml'))).toBe(true);
    expect(existsSync(path.join(rootDir, '.github/workflows/codeql.yml'))).toBe(true);
  });

  it('keeps a repo-local scripts/esbuild.mjs instead of the vendored one', async () => {
    const local = "// local esbuild-only variant, no rollup-plugin-dts\nexport const marker = 'repo-local';\n";
    await writeFixture('scripts/esbuild.mjs', local);
    const pkgPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { automator: Record<string, unknown> };
    pkg.automator = { ...pkg.automator, bundle: true };
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');

    await runUpgrade({ rootDir, isWindows: process.platform === 'win32', dryRun: false, enableJest: false, enableVitest: true });

    expect(await readFile(path.join(rootDir, 'scripts/esbuild.mjs'), 'utf8')).toBe(local);
  });

  it('copies the vendored scripts/esbuild.mjs when the repo has none', async () => {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { automator: Record<string, unknown> };
    pkg.automator = { ...pkg.automator, bundle: true };
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');

    await runUpgrade({ rootDir, isWindows: process.platform === 'win32', dryRun: false, enableJest: false, enableVitest: true });

    expect(existsSync(path.join(rootDir, 'scripts/esbuild.mjs'))).toBe(true);
    expect(await readFile(path.join(rootDir, 'scripts/esbuild.mjs'), 'utf8')).not.toContain('repo-local');
  });
});
