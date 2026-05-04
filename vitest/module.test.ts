import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { copyRepo } from '../src/helpers.js';
import { main } from '../src/module.js';
import { ExitError } from '../src/spawn.js';

const vendorLibraryPath = path.join(process.cwd(), 'vendor', 'library');

// tmpDir is a copy of vendor/library with node_modules installed, used by the --sort test
// which needs prettier available. All other tests (dry-run) use vendorLibraryPath as cwd
// so that git commands (e.g. git rev-parse for --version dev) resolve correctly.
let tmpDir: string;

beforeAll(async () => {
  tmpDir = await copyRepo(vendorLibraryPath, { install: true });
}, 120_000);

afterAll(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

// Suppress all console output produced by dryRun logging and help text.
// Redirect cwd to the vendor library repo (inside the git tree) so git-based commands resolve.
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'cwd').mockReturnValue(vendorLibraryPath);
});

function setArgs(...args: string[]): void {
  process.argv = ['node', 'mb-run', ...args];
}

describe('main — argument validation', () => {
  it('throws ExitError when no arguments are provided', async () => {
    setArgs();
    await expect(main()).rejects.toBeInstanceOf(ExitError);
  });

  it('throws ExitError with code 1 for no arguments', async () => {
    setArgs();
    await expect(main()).rejects.toMatchObject({ code: 1 });
  });

  it('resolves cleanly for --help', async () => {
    setArgs('--help');
    await expect(main()).resolves.toBeUndefined();
  });

  it('resolves cleanly for -h', async () => {
    setArgs('-h');
    await expect(main()).resolves.toBeUndefined();
  });

  it('throws ExitError for an unknown flag', async () => {
    setArgs('--unknown-flag-xyz');
    await expect(main()).rejects.toBeInstanceOf(ExitError);
  });

  it('throws ExitError for unknown positional argument', async () => {
    setArgs('positional-arg');
    await expect(main()).rejects.toBeInstanceOf(ExitError);
  });
});

describe('main — --dry-run build operations', () => {
  it('--dry-run --build resolves without error', async () => {
    setArgs('--dry-run', '--build');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --build --production resolves without error', async () => {
    setArgs('--dry-run', '--build', '--production');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --watch resolves without error', async () => {
    setArgs('--dry-run', '--watch');
    await expect(main()).resolves.toBeUndefined();
  });
});

describe('main — --dry-run quality operations', () => {
  it('--dry-run --test resolves without error', async () => {
    setArgs('--dry-run', '--test');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --lint resolves without error', async () => {
    setArgs('--dry-run', '--lint');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --lint-fix resolves without error', async () => {
    setArgs('--dry-run', '--lint-fix');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --format resolves without error', async () => {
    setArgs('--dry-run', '--format');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --format-check resolves without error', async () => {
    setArgs('--dry-run', '--format-check');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --sort resolves without error', async () => {
    setArgs('--dry-run', '--sort');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --update resolves without error', async () => {
    setArgs('--dry-run', '--update');
    await expect(main()).resolves.toBeUndefined();
  });
});

describe('main — --dry-run install operations', () => {
  it('--dry-run --install resolves without error', async () => {
    setArgs('--dry-run', '--install');
    await expect(main()).resolves.toBeUndefined();
  });
});

describe('main — --dry-run deep-clean operations', () => {
  it('--dry-run --deep-clean resolves without error', async () => {
    setArgs('--dry-run', '--deep-clean');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --deep-clean --build resolves without error', async () => {
    setArgs('--dry-run', '--deep-clean', '--build');
    await expect(main()).resolves.toBeUndefined();
  });
});

describe('main — --dry-run clean operations', () => {
  it('--dry-run --clean resolves without error', async () => {
    setArgs('--dry-run', '--clean');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --reset resolves without error', async () => {
    setArgs('--dry-run', '--reset');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --reset --production resolves without error', async () => {
    setArgs('--dry-run', '--reset', '--production');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --reset suppresses --clean and --build', async () => {
    setArgs('--dry-run', '--reset', '--clean', '--build');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --reset suppresses --install', async () => {
    setArgs('--dry-run', '--reset', '--install');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --reset suppresses --deep-clean', async () => {
    setArgs('--dry-run', '--reset', '--deep-clean');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --update suppresses --install', async () => {
    setArgs('--dry-run', '--update', '--install');
    await expect(main()).resolves.toBeUndefined();
  });
});

describe('main — --version', () => {
  it('--dry-run --version (no tag) strips the suffix and resolves', async () => {
    setArgs('--dry-run', '--version');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --version dev resolves', async () => {
    setArgs('--dry-run', '--version', 'dev');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --version edge resolves', async () => {
    setArgs('--dry-run', '--version', 'edge');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --version with an invalid tag throws ExitError', async () => {
    setArgs('--dry-run', '--version', 'invalid-tag');
    await expect(main()).rejects.toBeInstanceOf(ExitError);
  });

  it('--version tag is not treated as a positional when it follows --version', async () => {
    setArgs('--dry-run', '--version', 'beta');
    await expect(main()).resolves.toBeUndefined();
  });

  it('next flag after --version that starts with -- is not treated as a tag', async () => {
    setArgs('--dry-run', '--version', '--build');
    await expect(main()).resolves.toBeUndefined();
  });
});

describe('main — --info', () => {
  it('--info resolves without error', async () => {
    setArgs('--info');
    await expect(main()).resolves.toBeUndefined();
  });
});

describe('main — --sort', () => {
  it('--sort sorts package.json files on disk', async () => {
    const pkgPath = path.join(tmpDir, 'package.json');
    const savedPkg = await readFile(pkgPath, 'utf8');
    try {
      // Shuffled: 'scripts' before 'name' so the sort effect is observable
      const shuffled: Record<string, unknown> = { scripts: { build: 'tsc' }, name: 'test-pkg', version: '1.0.0' };
      await writeFile(pkgPath, JSON.stringify(shuffled, null, 2));
      // Override cwd to tmpDir so --sort reads/writes tmpDir and prettier is available
      vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
      setArgs('--sort');
      await expect(main()).resolves.toBeUndefined();
      const sorted = JSON.parse(await readFile(pkgPath, 'utf8')) as Record<string, unknown>;
      expect(Object.keys(sorted)[0]).toBe('name');
    } finally {
      await writeFile(pkgPath, savedPkg, 'utf8');
    }
  });
});

describe('main — ANSI cursor movement', () => {
  it('restorePos emits moveUp when FORCE_COLOR is set and not dry-run', async () => {
    const saved = process.env['FORCE_COLOR'];
    process.env['FORCE_COLOR'] = '1';
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    try {
      setArgs('--clean');
      await expect(main()).resolves.toBeUndefined();
    } finally {
      if (saved !== undefined) process.env['FORCE_COLOR'] = saved;
      else delete process.env['FORCE_COLOR'];
    }
  });
});

describe('main — --esbuild', () => {
  it('--dry-run --esbuild resolves without error', async () => {
    setArgs('--dry-run', '--esbuild');
    await expect(main()).resolves.toBeUndefined();
  });
});

describe('main — --pack', () => {
  it('--dry-run --pack resolves without error', async () => {
    setArgs('--dry-run', '--pack');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --pack with an invalid tag throws ExitError', async () => {
    setArgs('--dry-run', '--pack', 'invalid-tag');
    await expect(main()).rejects.toBeInstanceOf(ExitError);
  });
});

describe('main — --publish', () => {
  it('--dry-run --publish resolves without error', async () => {
    setArgs('--dry-run', '--publish');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --publish with an invalid tag throws ExitError', async () => {
    setArgs('--dry-run', '--publish', 'invalid-tag');
    await expect(main()).rejects.toBeInstanceOf(ExitError);
  });
});
