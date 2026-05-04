# <img src="https://matterbridge.io/assets/matterbridge.svg" alt="Matterbridge Logo" width="64px" height="64px">&nbsp;&nbsp;&nbsp;mb-run — Matterbridge command line executor

[![npm version](https://img.shields.io/npm/v/mb-run.svg)](https://www.npmjs.com/package/mb-run)
[![npm downloads](https://img.shields.io/npm/dt/mb-run.svg)](https://www.npmjs.com/package/mb-run)
![Node.js CI](https://github.com/Luligu/mb-run/actions/workflows/build.yml/badge.svg)
![CodeQL](https://github.com/Luligu/mb-run/actions/workflows/codeql.yml/badge.svg)
[![codecov](https://codecov.io/gh/Luligu/mb-run/branch/main/graph/badge.svg)](https://codecov.io/gh/Luligu/mb-run)
[![styled with prettier](https://img.shields.io/badge/styled_with-Prettier-f8bc45.svg?logo=prettier)](https://prettier.io/)
[![linted with eslint](https://img.shields.io/badge/linted_with-ES_Lint-4B32C3.svg?logo=eslint)](https://eslint.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![ESM](https://img.shields.io/badge/ESM-Node.js-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![matterbridge.io](https://img.shields.io/badge/matterbridge.io-online-brightgreen)](https://matterbridge.io)

---

`mb-run` is a developer CLI that runs the same operations as the `package.json` scripts in any Matterbridge project, but invokes the local binaries in `node_modules/.bin` directly — without going through `npm run`. This keeps output clean, avoids npm's startup overhead, and works reliably across plain packages, monorepos, plugins, and tools.

If you like this project and find it useful, please consider giving it a star on [GitHub](https://github.com/Luligu/mb-run) and sponsoring it.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://www.buymeacoffee.com/assets/img/custom_images/yellow_img.png" width="80" alt="Buy Me A Coffee"></a>

## Features

- **No npm overhead** — calls `tsc`, `eslint`, `prettier`, and `jest` directly from `node_modules/.bin`
- **Monorepo-aware** — automatically picks per-workspace `tsconfig.build.json` / `tsconfig.build.production.json` when present
- **Plugin-aware** — detects Matterbridge plugin context and runs `npm link matterbridge` automatically after install or reset
- **Composable flags** — combine multiple flags in a single invocation; operations always run in a deterministic order
- **Dry-run mode** — `--dry-run` logs every intended action without touching the file system or spawning processes
- **Verbose mode** — `--verbose` prints every external command before it is executed
- **Version management** — bumps versions for the root package and all workspace packages simultaneously, with prerelease tag support
- **Full pack & publish workflows** — backs up, strips, packs/publishes, and restores `package.json` automatically

## Requirements

- Node.js 20, 22, or 24
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
mb-run [flags] [--version [tag]]
```

Multiple flags can be combined. They are always executed in this fixed order regardless of how they appear on the command line:

> `install → update → deep-clean → reset → clean → version → build → test → format → lint → sort → pack → publish → esbuild → watch`

## Flags

| Flag                   | Description                                                                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--install`            | Runs `npm install --no-fund --no-audit`. In a Matterbridge plugin project, also runs `npm link matterbridge`.                                                                                                                           |
| `--reset`              | Empties `.cache/` and `node_modules/` (preserving directory structure for devcontainer named volumes), then runs `npm install` and rebuilds. Implies `--install` and `--build`.                                                         |
| `--reset --production` | Same as `--reset` but rebuilds using the production tsconfig.                                                                                                                                                                           |
| `--deep-clean`         | Same filesystem cleanup as `--reset` but skips the install and build steps.                                                                                                                                                             |
| `--clean`              | Removes `dist/` and all `.tsbuildinfo` files.                                                                                                                                                                                           |
| `--build`              | Compiles TypeScript using `tsc`. Prefers `tsconfig.build.json` per workspace when present, falls back to `tsconfig.json`.                                                                                                               |
| `--build --production` | Compiles for production. Prefers `tsconfig.build.production.json`, falls back to `tsconfig.build.json`, then `tsconfig.json`.                                                                                                           |
| `--watch`              | Runs `tsc` in watch mode using the build tsconfig.                                                                                                                                                                                      |
| `--test`               | Runs `jest --maxWorkers=100%` with `NODE_OPTIONS="--experimental-vm-modules --no-warnings"` set automatically.                                                                                                                          |
| `--lint`               | Runs `eslint --cache --max-warnings=0`.                                                                                                                                                                                                 |
| `--lint-fix`           | Runs `eslint --cache --fix --max-warnings=0`.                                                                                                                                                                                           |
| `--format`             | Runs `prettier --cache --write`.                                                                                                                                                                                                        |
| `--format-check`       | Runs `prettier --cache --check`.                                                                                                                                                                                                        |
| `--sort`               | Sorts top-level keys in all `package.json` files (root and all workspaces) using the canonical Matterbridge key order, then formats with Prettier.                                                                                      |
| `--update`             | Upgrades all dependencies using `npm-check-updates` (root + all workspaces), then runs `npm install`.                                                                                                                                   |
| `--pack`               | Full pack workflow: back up `package.json`, clean, production build, strip `devDependencies`/`scripts`, empty `node_modules`, `npm install --omit=dev`, `npm shrinkwrap`, `npm pack`, then restore everything.                          |
| `--publish`            | Full publish workflow: back up all `package.json` files, strip `devDependencies`/`scripts` from root and workspaces, `npm publish` root and every workspace, then restore all files.                                                    |
| `--esbuild`            | Bundles the project with esbuild.                                                                                                                                                                                                       |
| `--version [tag]`      | Updates the version in `package.json` (root and all workspaces) and regenerates `package-lock.json`. Without a tag, strips any prerelease suffix back to base semver. With a tag, produces `<baseVersion>-<tag>-<yyyymmdd>-<7charSha>`. |
| `--info`               | Prints system information: platform, hostname, memory, network interfaces, Node.js and npm versions.                                                                                                                                    |
| `--dry-run`            | Logs every intended action without modifying files or executing commands.                                                                                                                                                               |
| `--verbose`            | Prints each external command before it is executed.                                                                                                                                                                                     |
| `--help`, `-h`         | Prints usage text.                                                                                                                                                                                                                      |

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

- **Known entrypoints** (`tsc`, `jest`, `eslint`, `prettier`) are invoked as `node <entrypoint>` for reliability on all platforms.
- **Other binaries** are invoked via their shim in `node_modules/.bin` (using the `.cmd` variant on Windows).

## If you find this project useful

If you find this project useful, please consider giving it a star on GitHub and sponsoring it. Your support helps maintain and improve the project.

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/yellow_img.png)](https://www.buymeacoffee.com/luligugithub)
