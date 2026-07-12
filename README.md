# <img src="https://matterbridge.io/assets/matterbridge.svg" alt="Matterbridge Logo" width="64px" height="64px">&nbsp;&nbsp;&nbsp;mb-run — Matterbridge command line executor

[![npm version](https://img.shields.io/npm/v/mb-run.svg)](https://www.npmjs.com/package/mb-run)
[![npm downloads](https://img.shields.io/npm/dt/mb-run.svg)](https://www.npmjs.com/package/mb-run)
![Node.js CI](https://github.com/Luligu/mb-run/actions/workflows/build.yml/badge.svg)
![CodeQL](https://github.com/Luligu/mb-run/actions/workflows/codeql.yml/badge.svg)
[![codecov](https://codecov.io/gh/Luligu/mb-run/branch/main/graph/badge.svg)](https://codecov.io/gh/Luligu/mb-run)
[![tested with Vitest](https://img.shields.io/badge/tested_with-Vitest-6E9F18.svg?logo=vitest&logoColor=white)](https://vitest.dev)
[![styled with Oxc](https://img.shields.io/badge/styled_with-Oxc-9BE4E0.svg?logo=oxc&logoColor=white)](https://oxc.rs/docs/guide/usage/formatter.html)
[![linted with Oxc](https://img.shields.io/badge/linted_with-Oxc-9BE4E0.svg?logo=oxc&logoColor=white)](https://oxc.rs/docs/guide/usage/linter.html)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![TypeScript Native](https://img.shields.io/badge/TypeScript_Native-3178C6?logo=typescript&logoColor=white)](https://github.com/microsoft/typescript-go)
[![ESM](https://img.shields.io/badge/ESM-Node.js-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![matterbridge.io](https://img.shields.io/badge/matterbridge.io-online-brightgreen)](https://matterbridge.io)

---

`mb-run` is a developer CLI that runs the same operations as the `package.json` scripts in any Matterbridge project, but invokes the local binaries in `node_modules/.bin` directly — without going through `npm run`. This keeps output clean, avoids npm's startup overhead, and works reliably across plain packages, monorepos, plugins, and tools.

If you like this project and find it useful, please consider giving it a star on [GitHub](https://github.com/Luligu/mb-run) and sponsoring it.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://www.buymeacoffee.com/assets/img/custom_images/yellow_img.png" width="80" alt="Buy Me A Coffee"></a>

## Features

- **No npm overhead** — calls `tsgo`, `oxlint`, `oxfmt`, and `vitest` (or their `tsc`/`eslint`/`prettier`/`jest` fallbacks) directly from `node_modules/.bin`
- **Monorepo-aware** — automatically picks per-workspace `tsconfig.build.json` / `tsconfig.build.production.json` when present
- **Plugin-aware** — detects Matterbridge plugin context and runs `npm link matterbridge` automatically after install or reset
- **Composable flags** — combine multiple flags in a single invocation; operations always run in a deterministic order
- **Dry-run mode** — `--dry-run` logs every intended action without touching the file system or spawning processes
- **Verbose mode** — `--verbose` prints every external command before it is executed
- **Version management** — bumps versions for the root package and all workspace packages simultaneously, with prerelease tag support
- **Full pack & publish workflows** — backs up, strips, packs/publishes, and restores `package.json` automatically

## Requirements

- Node.js 20, 22, 24, or 26
- npm

## Installation

```bash
npm install -g mb-run
```

Or use it as a local dev dependency in your project:

```bash
npm install --save-dev mb-run
```

## Usage

```text
mb-run [flags] [--pack [tag]] [--publish [tag]] [--version [tag]]
```

Multiple flags can be combined. They are always executed in this fixed order regardless of how they appear on the command line:

> `info → install → update → upgrade → deep-clean → reset → version → clean → build → typecheck → test → format → lint → sort → pack → publish → esbuild → watch`

## Flags

| Flag                                   | Description                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--install`                            | Runs `npm install --no-fund --no-audit`. In a Matterbridge plugin project, also runs `npm link matterbridge`.                                                                                                                                                                                                                                                                                         |
| `--update`                             | Upgrades all dependencies with `npm-check-updates` (`ncu -u`) across the root and all workspaces, then runs `npm install`.                                                                                                                                                                                                                                                                            |
| `--upgrade [keywords...]`              | Upgrades the project's config and scaffolding files, then runs `npm install`. Optional keywords enable extras: `node`, `bun`, `jest`, `vitest`, `buntest`, `bundle`, `obfuscate`.                                                                                                                                                                                                                     |
| `--reset`                              | Empties `.cache/` and `node_modules/` (preserving directory structure for devcontainer named volumes), then runs `npm install` and rebuilds. Implies `--install` and `--build`.                                                                                                                                                                                                                       |
| `--reset --production`                 | Same as `--reset` but rebuilds using the production tsconfig.                                                                                                                                                                                                                                                                                                                                         |
| `--deep-clean`                         | Same filesystem cleanup as `--reset` but skips the install and build steps.                                                                                                                                                                                                                                                                                                                           |
| `--clean`                              | Removes `dist/` and all `.tsbuildinfo` files.                                                                                                                                                                                                                                                                                                                                                         |
| `--version [tag]`                      | Updates the version in `package.json` (root and all workspaces) and regenerates `package-lock.json`. Without a tag, strips any prerelease suffix back to base semver. With a tag, produces `<baseVersion>-<tag>-<yyyymmdd>-<7charSha>`.                                                                                                                                                               |
| `--build`                              | Compiles TypeScript, preferring `tsgo` and falling back to `tsc`. Prefers `tsconfig.build.json` per workspace when present, falls back to `tsconfig.json`.                                                                                                                                                                                                                                            |
| `--build --production`                 | Compiles for production. Prefers `tsconfig.build.production.json`, falls back to `tsconfig.build.json`, then `tsconfig.json`.                                                                                                                                                                                                                                                                         |
| `--typecheck`                          | Type-checks with `tsgo` (falling back to `tsc`) using the root `tsconfig.json` and `--noEmit`.                                                                                                                                                                                                                                                                                                        |
| `--watch`                              | Runs `tsgo` (falling back to `tsc`) in watch mode using the build tsconfig.                                                                                                                                                                                                                                                                                                                           |
| `--test [verbose\|watch\|coverage...]` | Runs each eligible test runner: Jest requires `jest.config.js` and its local binary; Vitest requires `vite.config.ts` and its local binary. When both qualify, Jest runs first, then Vitest. The optional keywords enable verbose output, watch mode, and coverage. Jest receives `NODE_OPTIONS="--experimental-vm-modules --no-warnings"` automatically.                                             |
| `--format`                             | Formats with `oxfmt`, falling back to `prettier`.                                                                                                                                                                                                                                                                                                                                                     |
| `--format --check`                     | Checks formatting instead of writing changes (combine `--format` with `--check`).                                                                                                                                                                                                                                                                                                                     |
| `--lint`                               | Lints with `oxlint`, falling back to `eslint`.                                                                                                                                                                                                                                                                                                                                                        |
| `--lint --fix`                         | Applies automatic lint fixes (combine `--lint` with `--fix`).                                                                                                                                                                                                                                                                                                                                         |
| `--sort`                               | Sorts top-level keys in all `package.json` files (root and all workspaces) using the canonical Matterbridge key order, then formats.                                                                                                                                                                                                                                                                  |
| `--pack [tag] [minify]`                | Full pack workflow: back up `package.json`, clean, production build, strip `devDependencies`/`scripts`, empty `node_modules`, `npm install --omit=dev`, `npm shrinkwrap`, `npm pack`, then restore everything. With an optional tag (`dev`, `edge`, `git`, `local`, `next`, `alpha`, `beta`), first bumps the version to `<baseVersion>-<tag>-<yyyymmdd>-<7charSha>`. `minify` compresses the bundle. |
| `--publish [tag]`                      | Full publish workflow: back up all `package.json` files, strip `devDependencies`/`scripts` from root and workspaces, `npm publish` root and every workspace, then restore all files. With an optional tag, first bumps the version to `<baseVersion>-<tag>-<yyyymmdd>-<7charSha>`.                                                                                                                    |
| `--esbuild [minify]`                   | Bundles the project with esbuild. `minify` compresses output and removes comments.                                                                                                                                                                                                                                                                                                                    |
| `--info`                               | Prints system information: platform, hostname, memory, network interfaces, Node.js, npm, and Bun versions, plus Bun install, cache, binary, and global module locations with their related environment variables.                                                                                                                                                                                     |
| `--dry-run`                            | Logs every intended action without modifying files or executing commands.                                                                                                                                                                                                                                                                                                                             |
| `--verbose`                            | Prints each external command before it is executed.                                                                                                                                                                                                                                                                                                                                                   |
| `--help`, `-h`                         | Prints usage text.                                                                                                                                                                                                                                                                                                                                                                                    |

## Version tags

The `--version` flag accepts the following prerelease tags:

`dev` · `edge` · `git` · `local` · `next` · `alpha` · `beta`

Examples:

```bash
# Tag a dev prerelease
mb-run --version dev
# → 1.2.3-dev-20260504-abc1234

# Strip back to base semver
mb-run --version
# → 1.2.3
```

## Examples

```bash
# Clean, build, lint, and format in one pass
mb-run --clean --build --lint --format

# Production build with dry-run preview
mb-run --build --production --dry-run

# Full reset and rebuild for a plugin
mb-run --reset

# Tag a dev prerelease, build, and pack
mb-run --version dev --build --production --pack

# Watch mode during development
mb-run --build --watch
```

## How it works

`mb-run` runs against the `package.json` in the **current working directory**. It does not assume it is being run from its own package root, so it is safe to install globally and use inside any Matterbridge project.

For each operation, `mb-run` resolves the tool binary from `node_modules/.bin` in the current project:

- **Known entrypoints** (`tsgo`, `tsc`, `jest`, `vitest`, `eslint`, `oxlint`, `prettier`) are invoked as `node <entrypoint>` for reliability on all platforms.
- **Other binaries** are invoked via their shim in `node_modules/.bin` (using the `.cmd` variant on Windows).

## If you find this project useful

If you find this project useful, please consider giving it a star on GitHub and sponsoring it. Your support helps maintain and improve the project.

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/yellow_img.png)](https://www.buymeacoffee.com/luligugithub)
