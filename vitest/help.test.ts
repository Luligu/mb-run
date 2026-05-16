import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { printPackUsage, printPublishUsage, printUsage, printVersionUsage } from '../src/help.js';

const VERSION_TAGS = ['dev', 'edge', 'git', 'local', 'next', 'alpha', 'beta'];

let output: string;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    output = String(args[0]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// printUsage
// ---------------------------------------------------------------------------
describe('printUsage', () => {
  it('logs exactly once', () => {
    const spy = vi.mocked(console.log);
    printUsage();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('includes the tool name', () => {
    printUsage();
    expect(output).toContain('mb-run');
  });

  it('includes every flag in the usage line', () => {
    printUsage();
    for (const flag of [
      '--install',
      '--reset',
      '--production',
      '--clean',
      '--deep-clean',
      '--build',
      '--watch',
      '--test',
      '--lint',
      '--lint-fix',
      '--format',
      '--format-check',
      '--oxformat',
      '--oxlint',
      '--sort',
      '--update',
      '--upgrade',
      '--pack',
      '--publish',
      '--esbuild',
      '--dry-run',
      '--version',
      '--verbose',
      '--info',
    ]) {
      expect(output, `missing flag ${flag}`).toContain(flag);
    }
  });

  it('includes every version tag in the usage line', () => {
    printUsage();
    for (const tag of VERSION_TAGS) {
      expect(output, `missing version tag ${tag}`).toContain(tag);
    }
  });

  it('documents the execution order of flags', () => {
    printUsage();
    const order = ['install', 'update', 'deep-clean', 'reset', 'clean', 'build', 'test', 'format', 'oxformat', 'lint', 'oxlint', 'sort', 'watch'];
    let lastIndex = -1;
    for (const step of order) {
      const idx = output.indexOf(step, lastIndex + 1);
      expect(idx, `execution order step "${step}" not found after previous step`).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
  });

  it('documents --install behavior', () => {
    printUsage();
    expect(output).toContain('--install');
    expect(output).toContain('npm install');
  });

  it('documents --reset behavior', () => {
    printUsage();
    expect(output).toContain('--reset');
    expect(output).toContain('node_modules');
  });

  it('documents --deep-clean behavior', () => {
    printUsage();
    expect(output).toContain('--deep-clean');
  });

  it('documents --test behavior', () => {
    printUsage();
    expect(output).toContain('--test');
    expect(output).toContain('NODE_OPTIONS');
  });

  it('documents --lint-fix behavior', () => {
    printUsage();
    expect(output).toContain('--lint-fix');
    expect(output).toContain('--fix');
  });

  it('documents --format-check behavior', () => {
    printUsage();
    expect(output).toContain('--format-check');
    expect(output).toContain('--check');
  });

  it('documents --oxformat behavior and config file', () => {
    printUsage();
    expect(output).toContain('--oxformat');
    expect(output).toContain('.oxfmtrc.json');
  });

  it('documents --oxlint behavior and config file', () => {
    printUsage();
    expect(output).toContain('--oxlint');
    expect(output).toContain('.oxlintrc.json');
  });

  it('documents --build tsconfig selection', () => {
    printUsage();
    expect(output).toContain('--build');
    expect(output).toContain('tsconfig.build.json');
  });

  it('documents --build --production tsconfig selection', () => {
    printUsage();
    expect(output).toContain('tsconfig.build.production.json');
  });

  it('documents --sort behavior', () => {
    printUsage();
    expect(output).toContain('--sort');
    expect(output).toContain('package.json');
  });

  it('documents --update behavior', () => {
    printUsage();
    expect(output).toContain('--update');
    expect(output).toContain('ncu');
  });

  it('documents --upgrade keywords', () => {
    printUsage();
    expect(output).toContain('--upgrade');
    for (const kw of ['jest', 'vitest', 'promiserules', 'typeaware', 'experimental']) {
      expect(output, `missing upgrade keyword ${kw}`).toContain(kw);
    }
  });

  it('documents --pack workflow', () => {
    printUsage();
    expect(output).toContain('--pack');
    expect(output).toContain('npm pack');
  });

  it('documents --publish workflow', () => {
    printUsage();
    expect(output).toContain('--publish');
    expect(output).toContain('npm publish');
  });

  it('documents --dry-run behavior', () => {
    printUsage();
    expect(output).toContain('--dry-run');
  });

  it('documents --version behavior', () => {
    printUsage();
    expect(output).toContain('--version');
  });

  it('documents --verbose behavior', () => {
    printUsage();
    expect(output).toContain('--verbose');
  });

  it('documents --info behavior', () => {
    printUsage();
    expect(output).toContain('--info');
  });
});

// ---------------------------------------------------------------------------
// printVersionUsage
// ---------------------------------------------------------------------------
describe('printVersionUsage', () => {
  it('logs exactly once', () => {
    const spy = vi.mocked(console.log);
    printVersionUsage();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('includes --version flag', () => {
    printVersionUsage();
    expect(output).toContain('--version');
  });

  it('includes all valid tags', () => {
    printVersionUsage();
    for (const tag of VERSION_TAGS) {
      expect(output, `missing tag ${tag}`).toContain(tag);
    }
  });

  it('describes the versioned suffix format', () => {
    printVersionUsage();
    expect(output).toContain('baseVersion');
  });
});

// ---------------------------------------------------------------------------
// printPackUsage
// ---------------------------------------------------------------------------
describe('printPackUsage', () => {
  it('logs exactly once', () => {
    const spy = vi.mocked(console.log);
    printPackUsage();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('includes --pack flag', () => {
    printPackUsage();
    expect(output).toContain('--pack');
  });

  it('includes all valid tags', () => {
    printPackUsage();
    for (const tag of VERSION_TAGS) {
      expect(output, `missing tag ${tag}`).toContain(tag);
    }
  });

  it('describes the pack workflow', () => {
    printPackUsage();
    expect(output).toContain('pack');
    expect(output).toContain('restores');
  });
});

// ---------------------------------------------------------------------------
// printPublishUsage
// ---------------------------------------------------------------------------
describe('printPublishUsage', () => {
  it('logs exactly once', () => {
    const spy = vi.mocked(console.log);
    printPublishUsage();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('includes --publish flag', () => {
    printPublishUsage();
    expect(output).toContain('--publish');
  });

  it('includes all valid tags', () => {
    printPublishUsage();
    for (const tag of VERSION_TAGS) {
      expect(output, `missing tag ${tag}`).toContain(tag);
    }
  });

  it('describes the publish workflow', () => {
    printPublishUsage();
    expect(output).toContain('publish');
    expect(output).toContain('restores');
  });
});
