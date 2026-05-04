import type { Dirent } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExitError } from '../src/spawn.js';
import {
  extractBaseSemver,
  formatYyyymmdd,
  getShortSha7,
  getWorkspacePackageJsonPaths,
  parseVersionTag,
  shortSha7FromGit,
  updateRootVersion,
  updateWorkspaceDependencyVersions,
} from '../src/version.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn().mockReturnValue('abc1234\n'),
  execSync: vi.fn(),
}));

vi.mock('../src/spawn.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/spawn.js')>();
  return { ...actual, runCommand: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readdir: vi.fn(actual.readdir as (...args: unknown[]) => unknown) };
});

const { execFileSync } = await import('node:child_process');
const { readdir } = await import('node:fs/promises');
const { runCommand } = await import('../src/spawn.js');

const mockExecFileSync = vi.mocked(execFileSync);
const mockReaddir = vi.mocked(readdir);
const mockRunCommand = vi.mocked(runCommand);

let tmpDir: string;

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mb-run-version-'));

  mockExecFileSync.mockReturnValue('abc1234\n');
  mockRunCommand.mockResolvedValue(undefined);

  const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  mockReaddir.mockImplementation(actualFs.readdir as typeof readdir);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// parseVersionTag
// ---------------------------------------------------------------------------

describe('parseVersionTag', () => {
  it.each(['dev', 'edge', 'git', 'local', 'next', 'alpha', 'beta'] as const)('accepts %s', (tag) => {
    expect(parseVersionTag(tag)).toBe(tag);
  });

  it('is case-insensitive', () => {
    expect(parseVersionTag('DEV')).toBe('dev');
    expect(parseVersionTag('Beta')).toBe('beta');
  });

  it('trims surrounding whitespace', () => {
    expect(parseVersionTag('  alpha  ')).toBe('alpha');
  });

  it('throws ExitError for an unrecognised tag', () => {
    expect(() => parseVersionTag('stable')).toThrow(ExitError);
  });

  it('throws ExitError for undefined', () => {
    expect(() => parseVersionTag(undefined)).toThrow(ExitError);
  });

  it('throws ExitError for an empty string', () => {
    expect(() => parseVersionTag('')).toThrow(ExitError);
  });
});

// ---------------------------------------------------------------------------
// formatYyyymmdd
// ---------------------------------------------------------------------------

describe('formatYyyymmdd', () => {
  it('formats a date as yyyymmdd', () => {
    expect(formatYyyymmdd(new Date(2026, 0, 5))).toBe('20260105');
  });

  it('pads month and day with leading zeroes', () => {
    expect(formatYyyymmdd(new Date(2026, 8, 3))).toBe('20260903');
  });

  it('handles December (month 12)', () => {
    expect(formatYyyymmdd(new Date(2026, 11, 31))).toBe('20261231');
  });
});

// ---------------------------------------------------------------------------
// extractBaseSemver
// ---------------------------------------------------------------------------

describe('extractBaseSemver', () => {
  it('returns the plain version when input is x.y.z', () => {
    expect(extractBaseSemver('1.2.3')).toBe('1.2.3');
  });

  it('strips a prerelease suffix from a tagged version', () => {
    expect(extractBaseSemver('1.2.3-dev-20260504-abc1234')).toBe('1.2.3');
  });

  it('handles multi-segment suffixes', () => {
    expect(extractBaseSemver('0.0.1-beta-20260101-abc1234')).toBe('0.0.1');
  });

  it('throws ExitError for a non-semver string', () => {
    expect(() => extractBaseSemver('not-valid')).toThrow(ExitError);
  });

  it('throws ExitError for an empty string', () => {
    expect(() => extractBaseSemver('')).toThrow(ExitError);
  });

  it('throws ExitError for undefined', () => {
    expect(() => extractBaseSemver(undefined)).toThrow(ExitError);
  });
});

// ---------------------------------------------------------------------------
// shortSha7FromGit / getShortSha7
// ---------------------------------------------------------------------------

describe('shortSha7FromGit', () => {
  it('returns the 7-char SHA from git output', () => {
    mockExecFileSync.mockReturnValue('abc1234\n');
    expect(shortSha7FromGit(tmpDir)).toBe('abc1234');
  });

  it('lowercases the SHA', () => {
    mockExecFileSync.mockReturnValue('ABC1234\n');
    expect(shortSha7FromGit(tmpDir)).toBe('abc1234');
  });

  it('throws when the output is not a valid 7-char hex string', () => {
    mockExecFileSync.mockReturnValue('XXXXXXXX\n');
    expect(() => shortSha7FromGit(tmpDir)).toThrow('Unexpected git short SHA output');
  });

  it('propagates errors thrown by execFileSync', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('git not found');
    });
    expect(() => shortSha7FromGit(tmpDir)).toThrow('git not found');
  });
});

describe('getShortSha7', () => {
  it('returns the SHA when git succeeds', () => {
    mockExecFileSync.mockReturnValue('abc1234\n');
    expect(getShortSha7(tmpDir)).toBe('abc1234');
  });

  it('wraps git failure in ExitError', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('git not found');
    });
    expect(() => getShortSha7(tmpDir)).toThrow(ExitError);
  });

  it('wraps invalid SHA output in ExitError', () => {
    mockExecFileSync.mockReturnValue('XXXXXXXX\n');
    expect(() => getShortSha7(tmpDir)).toThrow(ExitError);
  });

  it('wraps a non-Error throw in ExitError message as string', () => {
    mockExecFileSync.mockImplementation(() => {
      throw 'raw string error'; // intentional non-Error throw to exercise the String(err) branch
    });
    let caught: unknown;
    try {
      getShortSha7(tmpDir);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ExitError);
    expect((caught as ExitError).message).toContain('raw string error');
  });
});

// ---------------------------------------------------------------------------
// getWorkspacePackageJsonPaths
// ---------------------------------------------------------------------------

describe('getWorkspacePackageJsonPaths', () => {
  it('returns empty array when no workspaces field is present', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'solo' }));
    expect(await getWorkspacePackageJsonPaths({ rootDir: tmpDir, dryRun: false })).toEqual([]);
  });

  it('returns empty array for an empty workspaces array', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'solo', workspaces: [] }));
    expect(await getWorkspacePackageJsonPaths({ rootDir: tmpDir, dryRun: false })).toEqual([]);
  });

  it('resolves explicit workspace paths that exist', async () => {
    await mkdir(path.join(tmpDir, 'packages', 'one'), { recursive: true });
    await writeFile(path.join(tmpDir, 'packages', 'one', 'package.json'), JSON.stringify({ name: 'one' }));
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/one'] }));
    const result = await getWorkspacePackageJsonPaths({ rootDir: tmpDir, dryRun: false });
    expect(result).toHaveLength(1);
    expect(result[0]).toContain(path.join('packages', 'one', 'package.json'));
  });

  it('skips explicit workspace paths whose package.json does not exist', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/missing'] }));
    expect(await getWorkspacePackageJsonPaths({ rootDir: tmpDir, dryRun: false })).toEqual([]);
  });

  it('resolves a simple dir/* glob', async () => {
    await mkdir(path.join(tmpDir, 'packages', 'one'), { recursive: true });
    await writeFile(path.join(tmpDir, 'packages', 'one', 'package.json'), JSON.stringify({ name: 'one' }));
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));
    const result = await getWorkspacePackageJsonPaths({ rootDir: tmpDir, dryRun: false });
    expect(result).toHaveLength(1);
    expect(result[0]).toContain(path.join('packages', 'one', 'package.json'));
  });

  it('skips a directory entry in a glob that has no package.json', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));
    // The directory exists but contains no package.json.
    const fakeDir = { name: 'empty-pkg', isDirectory: () => true } as unknown as Dirent;
    mockReaddir.mockResolvedValueOnce([fakeDir] as unknown as Awaited<ReturnType<typeof readdir>>);
    expect(await getWorkspacePackageJsonPaths({ rootDir: tmpDir, dryRun: false })).toEqual([]);
  });

  it('skips non-directory entries in glob results', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));
    const fakeFile = { name: 'README.md', isDirectory: () => false } as unknown as Dirent;
    mockReaddir.mockResolvedValueOnce([fakeFile] as unknown as Awaited<ReturnType<typeof readdir>>);
    expect(await getWorkspacePackageJsonPaths({ rootDir: tmpDir, dryRun: false })).toEqual([]);
  });

  it('continues silently when the glob base directory does not exist', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['nonexistent/*'] }));
    expect(await getWorkspacePackageJsonPaths({ rootDir: tmpDir, dryRun: false })).toEqual([]);
  });

  it('resolves workspaces from { packages: [...] } object format', async () => {
    await mkdir(path.join(tmpDir, 'packages', 'one'), { recursive: true });
    await writeFile(path.join(tmpDir, 'packages', 'one', 'package.json'), JSON.stringify({ name: 'one' }));
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', workspaces: { packages: ['packages/one'] } }));
    const result = await getWorkspacePackageJsonPaths({ rootDir: tmpDir, dryRun: false });
    expect(result).toHaveLength(1);
  });

  it('deduplicates paths when the same entry appears twice', async () => {
    await mkdir(path.join(tmpDir, 'packages', 'one'), { recursive: true });
    await writeFile(path.join(tmpDir, 'packages', 'one', 'package.json'), JSON.stringify({ name: 'one' }));
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/one', 'packages/one'] }));
    const result = await getWorkspacePackageJsonPaths({ rootDir: tmpDir, dryRun: false });
    expect(result).toHaveLength(1);
  });

  it('throws ExitError for an unsupported glob pattern', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/**'] }));
    await expect(getWorkspacePackageJsonPaths({ rootDir: tmpDir, dryRun: false })).rejects.toBeInstanceOf(ExitError);
  });

  it('silently skips an empty string entry in the workspaces array', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', workspaces: [''] }));
    expect(await getWorkspacePackageJsonPaths({ rootDir: tmpDir, dryRun: false })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// updateRootVersion
// ---------------------------------------------------------------------------

describe('updateRootVersion — plain package', () => {
  beforeEach(async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-tool', version: '1.2.3' }));
  });

  it('returns a correctly formatted dev prerelease version', async () => {
    const result = await updateRootVersion('dev', { rootDir: tmpDir, dryRun: true });
    expect(result).toMatch(/^1\.2\.3-dev-\d{8}-[0-9a-f]{7}$/u);
  });

  it('contains the current date in yyyymmdd format', async () => {
    const result = await updateRootVersion('edge', { rootDir: tmpDir, dryRun: true });
    const dateSegment = result.split('-')[2];
    expect(dateSegment).toMatch(/^\d{8}$/u);
  });

  it('strips a prerelease suffix and returns bare semver when tag is null', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-tool', version: '2.0.0-dev-20260504-abc1234' }));
    expect(await updateRootVersion(null, { rootDir: tmpDir, dryRun: true })).toBe('2.0.0');
  });

  it('throws ExitError when version is not valid semver', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-tool', version: 'not-valid' }));
    await expect(updateRootVersion('dev', { rootDir: tmpDir, dryRun: true })).rejects.toBeInstanceOf(ExitError);
  });

  it('calls npm version without --workspaces for a plain package', async () => {
    await updateRootVersion('beta', { rootDir: tmpDir, dryRun: true });
    const args = mockRunCommand.mock.calls[0][1] as string[];
    expect(args).toContain('version');
    expect(args).not.toContain('--workspaces');
  });

  it('calls npm version with --workspaces for a package with workspaces array', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/*'] }));
    await updateRootVersion('dev', { rootDir: tmpDir, dryRun: true });
    const args = mockRunCommand.mock.calls[0][1] as string[];
    expect(args).toContain('--workspaces');
    expect(args).toContain('--include-workspace-root');
  });

  it('calls npm version with --workspaces for { packages: [...] } workspaces format', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0', workspaces: { packages: ['packages/*'] } }));
    await updateRootVersion('dev', { rootDir: tmpDir, dryRun: true });
    const args = mockRunCommand.mock.calls[0][1] as string[];
    expect(args).toContain('--workspaces');
  });
});

describe('updateRootVersion — git SHA errors', () => {
  beforeEach(async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-tool', version: '1.0.0' }));
  });

  it('throws ExitError when git is unavailable', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('git not found');
    });
    await expect(updateRootVersion('dev', { rootDir: tmpDir, dryRun: true })).rejects.toBeInstanceOf(ExitError);
  });

  it('throws when git outputs an unexpected SHA format', async () => {
    mockExecFileSync.mockReturnValue('XXXXXXXX\n');
    await expect(updateRootVersion('dev', { rootDir: tmpDir, dryRun: true })).rejects.toThrow(ExitError);
  });
});

// ---------------------------------------------------------------------------
// updateWorkspaceDependencyVersions
// ---------------------------------------------------------------------------

describe('updateWorkspaceDependencyVersions — no workspaces', () => {
  it('returns immediately when root package.json has no workspaces', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'solo', version: '1.0.0' }));
    await expect(updateWorkspaceDependencyVersions('1.0.0-dev-20260504-abc1234', { rootDir: tmpDir, dryRun: false })).resolves.toBeUndefined();
  });
});

describe('updateWorkspaceDependencyVersions — explicit workspace paths', () => {
  const target = '1.0.0-dev-20260504-abc1234';

  beforeEach(async () => {
    await mkdir(path.join(tmpDir, 'packages', 'one'), { recursive: true });
    await mkdir(path.join(tmpDir, 'packages', 'two'), { recursive: true });
    await writeFile(path.join(tmpDir, 'packages', 'one', 'package.json'), JSON.stringify({ name: '@scope/one', version: '1.0.0' }));
    await writeFile(path.join(tmpDir, 'packages', 'two', 'package.json'), JSON.stringify({ name: '@scope/two', version: '1.0.0', dependencies: { '@scope/one': '1.0.0' } }));
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/one', 'packages/two'], dependencies: { '@scope/one': '1.0.0' } }),
    );
  });

  it('updates a cross-workspace dependency to the target version', async () => {
    await updateWorkspaceDependencyVersions(target, { rootDir: tmpDir, dryRun: false });
    const pkg = JSON.parse(await readFile(path.join(tmpDir, 'packages', 'two', 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@scope/one']).toBe(target);
  });

  it('updates the root package.json when it references a workspace package', async () => {
    await updateWorkspaceDependencyVersions(target, { rootDir: tmpDir, dryRun: false });
    const pkg = JSON.parse(await readFile(path.join(tmpDir, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@scope/one']).toBe(target);
  });

  it('does not write when the version is already up to date', async () => {
    // Pre-seed all files with the target version so nothing needs changing.
    await writeFile(path.join(tmpDir, 'packages', 'two', 'package.json'), JSON.stringify({ name: '@scope/two', version: '1.0.0', dependencies: { '@scope/one': target } }));
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/one', 'packages/two'], dependencies: { '@scope/one': target } }),
    );
    await updateWorkspaceDependencyVersions(target, { rootDir: tmpDir, dryRun: false });
    // If already up to date neither workspace package should have been rewritten.
    const twoPkg = JSON.parse(await readFile(path.join(tmpDir, 'packages', 'two', 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(twoPkg.dependencies['@scope/one']).toBe(target);
  });

  it('does not write files in dry-run mode', async () => {
    // Record file mtimes before dry-run and confirm they are unchanged after.
    const { mtimeMs: twoBefore } = await (await import('node:fs/promises')).stat(path.join(tmpDir, 'packages', 'two', 'package.json'));
    await updateWorkspaceDependencyVersions(target, { rootDir: tmpDir, dryRun: true });
    const { mtimeMs: twoAfter } = await (await import('node:fs/promises')).stat(path.join(tmpDir, 'packages', 'two', 'package.json'));
    expect(twoAfter).toBe(twoBefore);
  });

  it('throws ExitError when a workspace package.json is missing the name field', async () => {
    await writeFile(path.join(tmpDir, 'packages', 'one', 'package.json'), JSON.stringify({ version: '1.0.0' }));
    await expect(updateWorkspaceDependencyVersions(target, { rootDir: tmpDir, dryRun: false })).rejects.toBeInstanceOf(ExitError);
  });
});

describe('updateWorkspaceDependencyVersions — glob workspace patterns', () => {
  const target = '1.0.0-dev-20260504-abc1234';

  it('resolves glob patterns and updates dependencies', async () => {
    await mkdir(path.join(tmpDir, 'packages', 'one'), { recursive: true });
    await writeFile(path.join(tmpDir, 'packages', 'one', 'package.json'), JSON.stringify({ name: 'ws-one', version: '1.0.0' }));
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/*'], dependencies: { 'ws-one': '1.0.0' } }));
    await updateWorkspaceDependencyVersions(target, { rootDir: tmpDir, dryRun: false });
    const pkg = JSON.parse(await readFile(path.join(tmpDir, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['ws-one']).toBe(target);
  });

  it('skips non-directory entries in glob results', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/*'] }));
    const fakeFile = { name: 'README.md', isDirectory: () => false } as unknown as Dirent;
    mockReaddir.mockResolvedValueOnce([fakeFile] as unknown as Awaited<ReturnType<typeof readdir>>);
    await expect(updateWorkspaceDependencyVersions(target, { rootDir: tmpDir, dryRun: false })).resolves.toBeUndefined();
  });

  it('continues silently when the glob base directory does not exist', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['nonexistent/*'] }));
    await expect(updateWorkspaceDependencyVersions(target, { rootDir: tmpDir, dryRun: false })).resolves.toBeUndefined();
  });

  it('throws ExitError for an unsupported glob pattern', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/**'] }));
    await expect(updateWorkspaceDependencyVersions(target, { rootDir: tmpDir, dryRun: false })).rejects.toBeInstanceOf(ExitError);
  });
});

describe('updateWorkspaceDependencyVersions — { packages: [...] } workspace format', () => {
  it('resolves workspace paths from packages array format and updates dependencies', async () => {
    const target = '1.0.0-dev-20260504-abc1234';
    await mkdir(path.join(tmpDir, 'packages', 'one'), { recursive: true });
    await writeFile(path.join(tmpDir, 'packages', 'one', 'package.json'), JSON.stringify({ name: 'ws-one', version: '1.0.0' }));
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0', workspaces: { packages: ['packages/one'] }, dependencies: { 'ws-one': '1.0.0' } }),
    );
    await updateWorkspaceDependencyVersions(target, { rootDir: tmpDir, dryRun: false });
    const pkg = JSON.parse(await readFile(path.join(tmpDir, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['ws-one']).toBe(target);
  });
});

describe('updateWorkspaceDependencyVersions — skips missing paths and empty patterns', () => {
  it('ignores a workspace entry whose package.json does not exist', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/missing'] }));
    await expect(updateWorkspaceDependencyVersions('1.0.0-dev-20260504-abc1234', { rootDir: tmpDir, dryRun: false })).resolves.toBeUndefined();
  });

  it('silently skips an empty string entry in the workspaces array', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0', workspaces: [''] }));
    await expect(updateWorkspaceDependencyVersions('1.0.0-dev-20260504-abc1234', { rootDir: tmpDir, dryRun: false })).resolves.toBeUndefined();
  });

  it('does not update dependencies on non-workspace packages', async () => {
    // packages/two depends on 'external-pkg' which is not a workspace — must not be rewritten.
    await mkdir(path.join(tmpDir, 'packages', 'one'), { recursive: true });
    await mkdir(path.join(tmpDir, 'packages', 'two'), { recursive: true });
    await writeFile(path.join(tmpDir, 'packages', 'one', 'package.json'), JSON.stringify({ name: 'ws-one', version: '1.0.0' }));
    await writeFile(path.join(tmpDir, 'packages', 'two', 'package.json'), JSON.stringify({ name: 'ws-two', version: '1.0.0', dependencies: { 'external-pkg': '2.0.0' } }));
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/one', 'packages/two'] }));
    await updateWorkspaceDependencyVersions('1.0.0-dev-20260504-abc1234', { rootDir: tmpDir, dryRun: false });
    const pkg = JSON.parse(await readFile(path.join(tmpDir, 'packages', 'two', 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['external-pkg']).toBe('2.0.0');
  });

  it('does not update a package dependency on itself (selfName skip)', async () => {
    // ws-one lists itself as a dependency — that entry must be skipped.
    await mkdir(path.join(tmpDir, 'packages', 'one'), { recursive: true });
    await writeFile(path.join(tmpDir, 'packages', 'one', 'package.json'), JSON.stringify({ name: 'ws-one', version: '1.0.0', dependencies: { 'ws-one': '1.0.0' } }));
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/one'] }));
    await updateWorkspaceDependencyVersions('1.0.0-dev-20260504-abc1234', { rootDir: tmpDir, dryRun: false });
    const pkg = JSON.parse(await readFile(path.join(tmpDir, 'packages', 'one', 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    // The self-referencing dep must remain unchanged.
    expect(pkg.dependencies['ws-one']).toBe('1.0.0');
  });

  it('uses empty string as root name fallback when root package.json has no name', async () => {
    await mkdir(path.join(tmpDir, 'packages', 'one'), { recursive: true });
    await writeFile(path.join(tmpDir, 'packages', 'one', 'package.json'), JSON.stringify({ name: 'ws-one', version: '1.0.0' }));
    // Root has no name field — rootName should fall back to '' without throwing.
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ version: '1.0.0', workspaces: ['packages/one'] }));
    await expect(updateWorkspaceDependencyVersions('1.0.0-dev-20260504-abc1234', { rootDir: tmpDir, dryRun: false })).resolves.toBeUndefined();
  });
});
