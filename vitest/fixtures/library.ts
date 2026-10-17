/**
 * @file vitest/fixtures/library.ts
 * @description Realistic on-disk library fixtures (single package and monorepo) for the real-tool esbuild, dts and pack tests.
 * @author Luca Liguori
 */

import { spawnSync } from 'node:child_process';
import { copyFile, cp, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/** The mb-run repository root, whose installed packages back the fixture node_modules. */
const repoDir = path.resolve(import.meta.dirname, '..', '..');

/** True when running on Windows. */
export const isWindows = process.platform === 'win32';

/** Name of the single-package fixture, shaped like matter-history. */
export const SINGLE_NAME = 'mb-fixture-single';

/** Name of the monorepo fixture root package, shaped like matterbridge. */
export const MONOREPO_NAME = 'mb-fixture-monorepo';

/** The shared tsconfig.base.json used by both fixtures, as in the real repositories. */
const tsconfigBase = {
  compilerOptions: {
    incremental: true,
    composite: true,
    target: 'esnext',
    lib: ['ESNext'],
    types: ['node'],
    module: 'nodenext',
    moduleResolution: 'nodenext',
    resolveJsonModule: true,
    allowJs: true,
    checkJs: true,
    declaration: true,
    declarationMap: true,
    sourceMap: true,
    preserveConstEnums: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    strict: true,
    noImplicitAny: true,
    alwaysStrict: true,
    noImplicitOverride: true,
    skipLibCheck: true,
  },
};

/**
 * Serializes a JSON value the way the real repositories store it.
 *
 * @param {unknown} value Value to serialize.
 * @returns {string} Pretty-printed JSON with a trailing newline.
 */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

/**
 * Writes a map of relative file paths to contents below a root directory.
 *
 * @param {string} rootDir Root directory.
 * @param {Record<string, string>} files Relative POSIX paths mapped to file contents.
 * @returns {Promise<void>} Resolves when every file is written.
 */
async function writeFiles(rootDir: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(rootDir, ...relativePath.split('/'));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
  }
}

/**
 * Links a directory the way npm does: a symlink on POSIX and a junction on Windows (no admin rights needed).
 *
 * @param {string} target Absolute path of the linked directory.
 * @param {string} linkPath Absolute path of the link to create.
 * @returns {Promise<void>} Resolves when the link exists.
 */
async function linkDir(target: string, linkPath: string): Promise<void> {
  await mkdir(path.dirname(linkPath), { recursive: true });
  await symlink(target, linkPath, 'junction');
}

/**
 * Links installed packages from the mb-run repository into a fixture or consumer node_modules.
 *
 * Node.js and TypeScript resolve through the real path, so the transitive dependencies of a
 * linked package (for example cross-spawn's `which`) resolve from the mb-run node_modules.
 *
 * @param {string} rootDir Directory that receives the node_modules folder.
 * @param {string[]} packageNames Package names to link.
 * @returns {Promise<void>} Resolves when every package is linked.
 */
export async function linkInstalledPackages(rootDir: string, packageNames: string[]): Promise<void> {
  for (const packageName of packageNames) {
    await linkDir(path.join(repoDir, 'node_modules', ...packageName.split('/')), path.join(rootDir, 'node_modules', ...packageName.split('/')));
  }
}

/**
 * Installs the toolchain a real project has in node_modules: TypeScript 7, the Node.js and
 * cross-spawn types, the cross-spawn runtime dependency with its hoisted transitive dependency
 * path-key, and the oxfmt formatter with its bin shim.
 *
 * @param {string} rootDir Fixture root directory.
 * @returns {Promise<void>} Resolves when the toolchain is linked.
 */
async function installToolchain(rootDir: string): Promise<void> {
  await linkInstalledPackages(rootDir, ['typescript', '@types/node', '@types/cross-spawn', 'cross-spawn', 'path-key', 'oxfmt']);
  const binDir = path.join(rootDir, 'node_modules', '.bin');
  await mkdir(binDir, { recursive: true });
  // Reuse npm's own shims: on Windows the .cmd shim resolves oxfmt relative to itself.
  if (isWindows) await copyFile(path.join(repoDir, 'node_modules', '.bin', 'oxfmt.cmd'), path.join(binDir, 'oxfmt.cmd'));
  else await symlink(path.join('..', 'oxfmt', 'bin', 'oxfmt'), path.join(binDir, 'oxfmt'));
}

/** Source of the shared greeting module used by both fixtures. */
const greetingTypesSource = `export enum LogLevel {
  Info = 'info',
  Debug = 'debug',
}

export type Punctuation = '.' | '!';

export interface GreetingOptions {
  name: string;
  excited?: boolean;
}
`;

/** Source of the shared formatting module used by both fixtures. */
const formatSource = `import type { GreetingOptions, Punctuation } from './types.js';

/**
 * Capitalizes the first letter of a text.
 *
 * @param {string} text Text to capitalize.
 * @returns {string} The capitalized text.
 */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Formats a greeting.
 *
 * @param {GreetingOptions} options Greeting options.
 * @returns {string} The greeting.
 */
export function formatGreeting(options: GreetingOptions): string {
  const punctuation: Punctuation = options.excited === true ? '!' : '.';
  return \`Hello, \${capitalize(options.name)}\${punctuation}\`;
}
`;

/**
 * Source of the Greeter class: extends a Node.js built-in and uses the shared types in its public API.
 *
 * @param {string} typesImport Module specifier of the shared greeting types and formatter.
 * @returns {string} The module source.
 */
const greeterSource = (typesImport: string): string => `import { EventEmitter } from 'node:events';

import { formatGreeting, type GreetingOptions, LogLevel } from '${typesImport}';

export interface GreeterEvents {
  greet: [message: string];
}

export class Greeter extends EventEmitter<GreeterEvents> {
  // A private member makes the class nominal: two separate declarations of it are incompatible types.
  private readonly createdAt = Date.now();

  constructor(
    readonly prefix: string,
    readonly level: LogLevel = LogLevel.Info,
  ) {
    super();
  }

  /**
   * Greets and emits the greeting.
   *
   * @param {GreetingOptions} options Greeting options.
   * @returns {string} The greeting.
   */
  greet(options: GreetingOptions): string {
    const message = \`\${this.prefix} \${formatGreeting(options)}\`;
    this.emit('greet', message);
    return message;
  }

  /**
   * Returns the creation time.
   *
   * @returns {number} Milliseconds since the epoch.
   */
  get created(): number {
    return this.createdAt;
  }
}

/**
 * Registers a greeter.
 *
 * @param {Greeter} greeter The greeter to register.
 * @returns {string} The registration message.
 */
export function registerGreeter(greeter: Greeter): string {
  return \`registered \${greeter.prefix}\`;
}
`;

/**
 * Source of a subclass exported from a second public subpath, like matterbridge/devices.
 *
 * @param {string} greeterImport Module specifier of the Greeter class.
 * @returns {string} The module source.
 */
const devicesSource = (greeterImport: string): string => `import type { GreetingOptions } from '@fixture/utils';

import { Greeter } from '${greeterImport}';

export class LoudGreeter extends Greeter {
  /**
   * Greets loudly.
   *
   * @param {GreetingOptions} options Greeting options.
   * @returns {string} The greeting in upper case.
   */
  override greet(options: GreetingOptions): string {
    return super.greet({ ...options, excited: true }).toUpperCase();
  }
}
`;

/** Source of a module that imports a hoisted transitive dependency (path-key, from cross-spawn) without declaring it, like matterbridge with @matter/general. */
const environmentSource = `import pathKey from 'path-key';

/**
 * Returns the name of the PATH environment variable on this platform.
 *
 * @returns {string} The variable name.
 */
export function pathVariableName(): string {
  return pathKey();
}
`;

/**
 * Source of the CLI module: uses an external runtime dependency and runs on import, like matterbridge's cli.
 *
 * @param {string} greeterImport Module specifier of the Greeter class.
 * @param {string} binName Name printed by the CLI.
 * @returns {string} The module source.
 */
const cliSource = (greeterImport: string, binName: string): string => `import spawn from 'cross-spawn';

import { Greeter } from '${greeterImport}';

/**
 * Runs the CLI.
 *
 * @returns {string} The printed output.
 */
export function runCli(): string {
  const result = spawn.sync(process.execPath, ['--version'], { encoding: 'utf8' });
  const output = \`\${new Greeter('${binName}').greet({ name: 'cli', excited: true })} node \${result.stdout.trim()}\`;
  console.log(output);
  return output;
}

runCli();
`;

/**
 * Creates a single-package library shaped like matter-history: one package, `src/` compiled
 * to `dist/`, a runtime dependency (cross-spawn) and a public `types` entry.
 *
 * @param {string} rootDir Empty fixture directory.
 * @returns {Promise<void>} Resolves when the fixture is on disk with its node_modules.
 */
export async function createSinglePackageFixture(rootDir: string): Promise<void> {
  await writeFiles(rootDir, {
    'package.json': json({
      name: SINGLE_NAME,
      version: '1.0.0',
      description: 'Single-package library fixture',
      license: 'Apache-2.0',
      type: 'module',
      main: 'dist/module.js',
      types: 'dist/module.d.ts',
      exports: { '.': { import: './dist/module.js', types: './dist/module.d.ts' } },
      bin: { [SINGLE_NAME]: 'bin/cli.js' },
      files: ['bin', 'dist', 'npm-shrinkwrap.json'],
      automator: { library: true },
      scripts: { build: 'tsc --project tsconfig.build.json' },
      dependencies: { 'cross-spawn': '7.0.6' },
      devDependencies: { '@types/cross-spawn': '6.0.6', '@types/node': '26.6.5', 'oxfmt': '0.73.0', 'typescript': '7.0.2' },
    }),
    'tsconfig.base.json': json(tsconfigBase),
    'tsconfig.json': json({ extends: './tsconfig.base.json', compilerOptions: { noEmit: true }, include: ['src/**/*.ts'] }),
    'tsconfig.build.json': json({
      extends: './tsconfig.base.json',
      compilerOptions: { types: ['node'], outDir: 'dist', rootDir: 'src' },
      include: ['src/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.test.ts'],
    }),
    'tsconfig.build.production.json': json({
      extends: './tsconfig.base.json',
      compilerOptions: {
        types: ['node'],
        outDir: 'dist',
        rootDir: 'src',
        incremental: false,
        composite: false,
        declaration: true,
        declarationMap: false,
        sourceMap: false,
        removeComments: false,
      },
      include: ['src/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.test.ts'],
    }),
    'bin/cli.js': `#!/usr/bin/env node\nimport '../dist/cli.js';\n`,
    'src/types.ts': greetingTypesSource,
    'src/format.ts': formatSource,
    'src/greeter.ts': greeterSource('./export.js'),
    'src/export.ts': `export * from './format.js';\nexport * from './types.js';\n`,
    'src/cli.ts': cliSource('./greeter.js', SINGLE_NAME),
    'src/module.ts': `export * from './export.js';\nexport * from './greeter.js';\n`,
  });
  await installToolchain(rootDir);
}

/**
 * Creates a monorepo library shaped like matterbridge: a published root package whose `src/`
 * re-exports two private-by-name workspace packages (`@fixture/utils`, `@fixture/core`) built
 * with project references, with subpath exports, a `bin` launcher that imports a workspace
 * subpath, and runtime dependencies declared only in a workspace package.
 *
 * @param {string} rootDir Empty fixture directory.
 * @returns {Promise<void>} Resolves when the fixture is on disk with its node_modules and workspace links.
 */
export async function createMonorepoFixture(rootDir: string): Promise<void> {
  const workspaceTsconfig = (references: string[]): Record<string, unknown> => ({
    extends: '../../tsconfig.base.json',
    compilerOptions: { types: ['node'], outDir: 'dist', rootDir: 'src' },
    include: ['src/**/*.ts'],
    exclude: ['**/*.spec.ts', '**/*.test.ts'],
    ...(references.length > 0 ? { references: references.map((reference) => ({ path: reference })) } : {}),
  });
  const workspaceProductionTsconfig = (references: string[]): Record<string, unknown> => ({
    extends: '../../tsconfig.base.json',
    compilerOptions: { types: ['node'], outDir: 'dist', rootDir: 'src', removeComments: true, declarationMap: false, sourceMap: false },
    include: ['src/**/*.ts'],
    exclude: ['**/*.spec.ts', '**/*.test.ts'],
    ...(references.length > 0 ? { references: references.map((reference) => ({ path: reference })) } : {}),
  });

  await writeFiles(rootDir, {
    'package.json': json({
      name: MONOREPO_NAME,
      version: '1.0.0',
      description: 'Monorepo library fixture',
      license: 'Apache-2.0',
      type: 'module',
      main: 'dist/export.js',
      types: 'dist/export.d.ts',
      exports: {
        '.': { import: './dist/export.js', types: './dist/export.d.ts' },
        './utils': { import: './dist/utils/export.js', types: './dist/utils/export.d.ts' },
        './devices': { import: './dist/devices/export.js', types: './dist/devices/export.d.ts' },
      },
      bin: { [MONOREPO_NAME]: 'bin/cli.js' },
      files: ['bin', 'dist', 'npm-shrinkwrap.json'],
      workspaces: ['packages/utils', 'packages/core'],
      automator: { library: true },
      scripts: { build: 'tsc --build tsconfig.build.json' },
      dependencies: { '@fixture/core': '1.0.0', '@fixture/utils': '1.0.0' },
      devDependencies: { '@types/cross-spawn': '6.0.6', '@types/node': '26.6.5', 'oxfmt': '0.73.0', 'typescript': '7.0.2' },
    }),
    'tsconfig.base.json': json(tsconfigBase),
    'tsconfig.json': json({ extends: './tsconfig.base.json', compilerOptions: { noEmit: true }, include: ['src/**/*.ts', 'packages/*/src/**/*.ts'] }),
    'tsconfig.build.json': json({
      files: [],
      references: [{ path: './packages/utils/tsconfig.build.json' }, { path: './packages/core/tsconfig.build.json' }, { path: './tsconfig.root.build.json' }],
    }),
    'tsconfig.build.production.json': json({
      files: [],
      references: [
        { path: './packages/utils/tsconfig.build.production.json' },
        { path: './packages/core/tsconfig.build.production.json' },
        { path: './tsconfig.root.build.production.json' },
      ],
    }),
    'tsconfig.root.build.json': json({
      extends: './tsconfig.base.json',
      compilerOptions: { outDir: 'dist', rootDir: 'src' },
      include: ['src/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.test.ts'],
      references: [{ path: './packages/core/tsconfig.build.json' }],
    }),
    'tsconfig.root.build.production.json': json({
      extends: './tsconfig.base.json',
      compilerOptions: { outDir: 'dist', rootDir: 'src', removeComments: true, declarationMap: false, sourceMap: false },
      include: ['src/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.test.ts'],
      references: [{ path: './packages/core/tsconfig.build.production.json' }],
    }),
    'bin/cli.js': `#!/usr/bin/env node\nimport('@fixture/core/cli');\n`,
    'src/export.ts': `export * from '@fixture/core';\n`,
    'src/utils/export.ts': `export * from '@fixture/utils';\n`,
    'src/devices/export.ts': `export * from '@fixture/core/devices';\n`,

    'packages/utils/package.json': json({
      name: '@fixture/utils',
      version: '1.0.0',
      type: 'module',
      main: './dist/export.js',
      types: './dist/export.d.ts',
      exports: { '.': { types: './dist/export.d.ts', import: './dist/export.js' } },
    }),
    'packages/utils/tsconfig.build.json': json(workspaceTsconfig([])),
    'packages/utils/tsconfig.build.production.json': json(workspaceProductionTsconfig([])),
    'packages/utils/src/types.ts': greetingTypesSource,
    'packages/utils/src/format.ts': formatSource,
    'packages/utils/src/export.ts': `export * from './format.js';\nexport * from './types.js';\n`,

    'packages/core/package.json': json({
      name: '@fixture/core',
      version: '1.0.0',
      type: 'module',
      main: './dist/export.js',
      types: './dist/export.d.ts',
      exports: {
        '.': { types: './dist/export.d.ts', import: './dist/export.js' },
        './cli': { types: './dist/cli.d.ts', import: './dist/cli.js' },
        './devices': { types: './dist/devices.d.ts', import: './dist/devices.js' },
      },
      dependencies: { '@fixture/utils': '1.0.0', 'cross-spawn': '7.0.6' },
    }),
    'packages/core/tsconfig.build.json': json(workspaceTsconfig(['../utils/tsconfig.build.json'])),
    'packages/core/tsconfig.build.production.json': json(workspaceProductionTsconfig(['../utils/tsconfig.build.production.json'])),
    'packages/core/src/greeter.ts': greeterSource('@fixture/utils'),
    'packages/core/src/cli.ts': cliSource('./greeter.js', MONOREPO_NAME),
    'packages/core/src/devices.ts': devicesSource('./greeter.js'),
    'packages/core/src/environment.ts': environmentSource,
    'packages/core/src/export.ts': `export * from '@fixture/utils';\nexport * from './environment.js';\nexport * from './greeter.js';\n`,
  });
  await installToolchain(rootDir);
  // npm workspaces link each workspace package into the root node_modules.
  await linkDir(path.join(rootDir, 'packages', 'utils'), path.join(rootDir, 'node_modules', '@fixture', 'utils'));
  await linkDir(path.join(rootDir, 'packages', 'core'), path.join(rootDir, 'node_modules', '@fixture', 'core'));
}

/**
 * Lists every file below a directory as sorted POSIX paths relative to it.
 *
 * @param {string} rootDir Directory to walk.
 * @returns {Promise<string[]>} Sorted relative file paths.
 */
export async function listFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(entryPath);
      else files.push(path.relative(rootDir, entryPath).split(path.sep).join('/'));
    }
  };
  await walk(rootDir);
  return files.toSorted();
}

/**
 * Copies a published package (its `package.json` and `dist`) into a consumer project's
 * node_modules, as npm would install it: workspace links and sources are deliberately left behind.
 *
 * @param {string} packageDir Directory holding the publishable package.
 * @param {string} consumerDir Consumer project directory.
 * @param {string} packageName Package name.
 * @returns {Promise<string>} The installed package directory.
 */
export async function installIntoConsumer(packageDir: string, consumerDir: string, packageName: string): Promise<string> {
  const installedDir = path.join(consumerDir, 'node_modules', packageName);
  await mkdir(installedDir, { recursive: true });
  await copyFile(path.join(packageDir, 'package.json'), path.join(installedDir, 'package.json'));
  await cp(path.join(packageDir, 'dist'), path.join(installedDir, 'dist'), { recursive: true });
  return installedDir;
}

/**
 * Creates a consumer project that imports the library by package name, with TypeScript 7 and
 * full declaration checking (`skipLibCheck: false`) so broken or incomplete declarations fail.
 *
 * The consumer only has the library's real runtime dependency (cross-spawn): if any shipped
 * file still references an unshipped workspace package, resolution fails.
 *
 * @param {string} consumerDir Empty consumer directory.
 * @param {string} packageName Library package name.
 * @param {string | null} utilsSubpath Subpath export of the utilities, or null when the library has none.
 * @param {string | null} [devicesSubpath] Subpath export of the Greeter subclass, used to pass a class from one subpath to an API of another.
 * @returns {Promise<void>} Resolves when the consumer is on disk.
 */
export async function createConsumer(consumerDir: string, packageName: string, utilsSubpath: string | null, devicesSubpath: string | null = null): Promise<void> {
  const utilsImport = utilsSubpath === null ? packageName : `${packageName}/${utilsSubpath}`;
  // A subclass from one subpath must be accepted where another subpath expects the base class: this
  // fails when each declaration entry carries its own copy of the class (private members make it nominal).
  const devicesCode =
    devicesSubpath === null
      ? ''
      : `
import { LoudGreeter } from '${packageName}/${devicesSubpath}';
import { registerGreeter } from '${packageName}';

const loud: Greeter = new LoudGreeter('loud');
export const registered: string = registerGreeter(new LoudGreeter('loud')) + loud.prefix;
`;
  await writeFiles(consumerDir, {
    'package.json': json({ name: 'consumer', version: '1.0.0', private: true, type: 'module' }),
    'tsconfig.json': json({
      compilerOptions: { target: 'esnext', module: 'nodenext', moduleResolution: 'nodenext', strict: true, noEmit: true, skipLibCheck: false, types: ['node'] },
      include: ['index.ts'],
    }),
    'index.ts': `import { Greeter, LogLevel, type GreeterEvents, type GreetingOptions } from '${packageName}';
import { capitalize, formatGreeting, type Punctuation } from '${utilsImport}';

const options: GreetingOptions = { name: 'matter', excited: true };
const greeter = new Greeter('consumer', LogLevel.Debug);
greeter.on('greet', (message: string) => message.length);
const greeting: string = greeter.greet(options);
const formatted: string = formatGreeting(options);
const punctuation: Punctuation = '!';
const events: GreeterEvents = { greet: [capitalize(greeting)] };

// @ts-expect-error -- name must be a string: proves the declarations are real types, not any
formatGreeting({ name: 42 });

export { events, formatted, punctuation };
${devicesCode}`,
  });
  // npm hoists cross-spawn's own dependencies (path-key) next to it.
  await linkInstalledPackages(consumerDir, ['typescript', '@types/node', 'cross-spawn', 'path-key']);
}

/**
 * Runs Node.js synchronously in a directory and returns its result.
 *
 * @param {string[]} args Node.js arguments.
 * @param {string} cwd Working directory.
 * @returns {{ status: number | null; stdout: string; stderr: string }} The exit status and the captured output.
 */
export function runNode(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Runtime smoke test executed in the consumer: imports the library by name and exercises it.
 *
 * @param {string} packageName Library package name.
 * @param {string | null} utilsSubpath Subpath export of the utilities, or null when the library has none.
 * @param {string | null} [devicesSubpath] Subpath export of the Greeter subclass, or null when the library has none.
 * @returns {string} An ES module script for `node --input-type=module -e`.
 */
export function consumerRuntimeScript(packageName: string, utilsSubpath: string | null, devicesSubpath: string | null = null): string {
  const utilsImport = utilsSubpath === null ? packageName : `${packageName}/${utilsSubpath}`;
  const devicesCode =
    devicesSubpath === null
      ? ''
      : `const { LoudGreeter } = await import('${packageName}/${devicesSubpath}');
const { registerGreeter, pathVariableName } = await import('${packageName}');
const loud = new LoudGreeter('loud');
Object.assign(result, { loud: loud.greet({ name: 'matter' }), registered: registerGreeter(loud), sameClass: loud instanceof Greeter, pathVariable: pathVariableName() });
`;
  return `import { Greeter, LogLevel } from '${packageName}';
import { formatGreeting } from '${utilsImport}';
const greeter = new Greeter('runtime', LogLevel.Debug);
let emitted = '';
greeter.on('greet', (message) => { emitted = message; });
greeter.greet({ name: 'matter', excited: true });
const result = { emitted, formatted: formatGreeting({ name: 'bridge' }), level: greeter.level };
${devicesCode}console.log(JSON.stringify(result));
`;
}

/**
 * Expected output of {@link consumerRuntimeScript}.
 *
 * @param {boolean} withDevices Whether the library has the devices subpath.
 * @returns {Record<string, unknown>} The expected JSON object.
 */
export function expectedRuntimeResult(withDevices: boolean): Record<string, unknown> {
  const base = { emitted: 'runtime Hello, Matter!', formatted: 'Hello, Bridge.', level: 'debug' };
  // path-key returns the PATH variable name as spelled in this environment (Path on Windows).
  return withDevices ? { ...base, loud: 'LOUD HELLO, MATTER!', registered: 'registered loud', sameClass: true, pathVariable: isWindows ? 'Path' : 'PATH' } : base;
}

/**
 * Checks shipped declaration files: none may reference a workspace package, and every relative
 * import (shared declaration chunks) must resolve to a shipped declaration file.
 *
 * @param {string} baseDir Directory the declaration paths are relative to.
 * @param {string[]} declarationFiles Shipped declaration files, as POSIX paths relative to baseDir.
 * @returns {Promise<string[]>} One message per problem; empty when every file is consumable.
 */
export async function findDeclarationProblems(baseDir: string, declarationFiles: string[]): Promise<string[]> {
  const shipped = new Set(declarationFiles);
  const problems: string[] = [];
  for (const file of declarationFiles) {
    const source = await readFile(path.join(baseDir, ...file.split('/')), 'utf8');
    if (source.includes('@fixture/')) problems.push(`${file}: references a workspace package`);
    for (const match of source.matchAll(/(?:from|import\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = path.posix.join(path.posix.dirname(file), match[1]);
      const candidates = [target.replace(/\.js$/, '.d.ts'), `${target}.d.ts`, target];
      if (!candidates.some((candidate) => shipped.has(candidate))) problems.push(`${file}: unresolved ${match[1]}`);
    }
  }
  return problems;
}
