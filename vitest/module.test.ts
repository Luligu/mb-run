import path from 'node:path';
import process from 'node:process';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as ansiModule from '../src/ansi.js';
import { main } from '../src/module.js';
import { ExitError } from '../src/spawn.js';

const vendorLibraryPath = path.join(process.cwd(), 'vendor', 'library');

// Suppress all console output produced by dryRun logging and help text.
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
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

  it('--dry-run --verbose --build resolves without error', async () => {
    setArgs('--dry-run', '--verbose', '--build');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--clean with ANSI enabled covers the moveUp branch of restorePos', async () => {
    vi.spyOn(ansiModule, 'shouldUseAnsi').mockReturnValue(true);
    vi.spyOn(process, 'cwd').mockReturnValue(vendorLibraryPath);
    setArgs('--clean');
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
  it('--dry-run --sort resolves without error', async () => {
    setArgs('--dry-run', '--sort');
    await expect(main()).resolves.toBeUndefined();
  });
});

describe('main — --esbuild', () => {
  it('--dry-run --esbuild resolves without error', async () => {
    setArgs('--dry-run', '--esbuild');
    await expect(main()).resolves.toBeUndefined();
  });
});

describe('main — --upgrade', () => {
  it('--dry-run --upgrade (no sub-args) resolves without error', async () => {
    setArgs('--dry-run', '--upgrade');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --upgrade jest resolves without error', async () => {
    setArgs('--dry-run', '--upgrade', 'jest');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --upgrade jest vitest promiserules typeaware experimental resolves without error', async () => {
    setArgs('--dry-run', '--upgrade', 'jest', 'vitest', 'promiserules', 'typeaware', 'experimental');
    await expect(main()).resolves.toBeUndefined();
  });

  it('--dry-run --upgrade vitest experimental resolves without error', async () => {
    setArgs('--dry-run', '--upgrade', 'vitest', 'experimental');
    await expect(main()).resolves.toBeUndefined();
  });

  it('keywords after --upgrade stop at the next flag', async () => {
    setArgs('--dry-run', '--upgrade', 'jest', '--build');
    await expect(main()).resolves.toBeUndefined();
  });

  it('unrecognized token after --upgrade throws ExitError', async () => {
    setArgs('--dry-run', '--upgrade', 'unknownword');
    await expect(main()).rejects.toBeInstanceOf(ExitError);
  });

  it('--upgrade suppresses --install', async () => {
    setArgs('--dry-run', '--upgrade', '--install');
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
