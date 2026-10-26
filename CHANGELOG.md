# <img src="https://matterbridge.io/assets/matterbridge.svg" alt="Matterbridge Logo" width="64px" height="64px">&nbsp;&nbsp;&nbsp;Matterbridge command line executor

[![npm version](https://img.shields.io/npm/v/mb-run.svg)](https://www.npmjs.com/package/mb-run)
[![npm downloads](https://img.shields.io/npm/dt/mb-run.svg)](https://www.npmjs.com/package/mb-run)
![Node.js CI](https://github.com/Luligu/mb-run/actions/workflows/build.yml/badge.svg)
![CodeQL](https://github.com/Luligu/mb-run/actions/workflows/codeql.yml/badge.svg)
[![codecov](https://codecov.io/gh/Luligu/mb-run/branch/main/graph/badge.svg)](https://codecov.io/gh/Luligu/mb-run)
[![tested with Vitest](https://img.shields.io/badge/tested_with-Vitest-6E9F18.svg?logo=vitest&logoColor=white)](https://vitest.dev)
[![styled with Oxc](https://img.shields.io/badge/styled_with-Oxc-9BE4E0.svg?logo=oxc&logoColor=white)](https://oxc.rs/docs/guide/usage/formatter.html)
[![linted with Oxc](https://img.shields.io/badge/linted_with-Oxc-9BE4E0.svg?logo=oxc&logoColor=white)](https://oxc.rs/docs/guide/usage/linter.html)
[![TypeScript Native](https://img.shields.io/badge/TypeScript_Native-3178C6?logo=typescript&logoColor=white)](https://github.com/microsoft/typescript-go)
[![ESM](https://img.shields.io/badge/ESM-Node.js-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![matterbridge.io](https://img.shields.io/badge/matterbridge.io-online-brightgreen)](https://matterbridge.io)

---

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

If you like this project and find it useful, please consider giving it a star on [GitHub](https://github.com/Luligu/mb-run) and sponsoring it.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="120"></a>

## [1.1.4] - Dev branch

### Changed

- [template]: Update the plugin frontend guide to v.1.0.1: build API URLs from Vite's base URL to preserve Home Assistant Ingress paths.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [1.1.3] - 2026-10-24

### Added

- [template]: Add the Copilot `Matterbridge` custom agent (`.github/agents/matterbridge.agent.md`) to the plugin template.
- [scripts]: Add the Bun tests of the scripts from matterbridge-native in `scripts/buntest`, run by `npm run test:bun`. The `prepublish-clean` tests cover v.2.2.0.
- [upgrade]: When the package has `scripts/buntest`, remove the `'**/scripts/**'` ignore patterns from `bunfig.toml`, so Bun runs the script tests and measures their coverage.
- [upgrade]: Add `automator.minify`, which adds `minify` to the `prepublishOnly` esbuild step when `automator.bundle` is enabled.
- [template]: Update `.vscode/tasks.json` to 1.0.6 with the `Bundle`, `Minify` and `Obfuscate` tasks (`mb-run --esbuild`, with `minify` and `minify obfuscate`) and the `Pack`, `Pack Minify` and `Pack Obfuscate` tasks (`mb-run --pack`, with `minify` and `minify obfuscate`), plus the `Docker: Ubuntu Install`, `Docker: Debian Install` and `Docker: Alpine Install` tasks.

### Changed

- [upgrade]: Remove the `bundle` and `obfuscate` scripts, replaced by the `Bundle`, `Minify` and `Obfuscate` VS Code tasks.
- [upgrade]: Drop `npm pkg delete devDependencies scripts automator` from `prepublishOnly`: `scripts/prepublish-clean.mjs` now deletes those fields.
- [upgrade]: With `automator.bundle`, `prepublishOnly` builds with `npx --yes mb-run@latest --esbuild` (plus `minify`/`obfuscate` when enabled) instead of `npm run cleanBuildProduction`.
- [upgrade]: Stop installing `esbuild`, `javascript-obfuscator`, `rollup`, `rollup-plugin-dts` and `@typescript/typescript6` as devDependencies (mb-run ships them), and remove them from packages that have them.
- [upgrade]: Run `npm-check-updates@latest` in the `checkDependencies` and `updateDependencies` scripts (also in the frontend template), so npx never reuses a stale cached version.
- [upgrade]: Always remove `scripts/esbuild.mjs` from packages, since `mb-run --esbuild` supersedes it; the template keeps it.
- [template]: Update the testing rule to 1.0.6 from matterbridge (run `bun test` only through `npm run test:bun`, new Bun vs Vitest section).
- [template]: Update `CLAUDE.md` (1.0.6), `GEMINI.md` (1.0.1) and `copilot-instructions.md` (1.0.7) from matterbridge, dropping the hardcoded `/verify-agent-context` skill example.
- [template]: Align `.codex/rules/default.rules` to 1.0.7 and `.agents/README.md` to 1.0.3 with matterbridge (note that skill mirrors also offer the skill through their `description`).
- [template]: Update `AGENTS.md` and `AGENTS.plugin.md` to 1.0.6 with the generic wording from matterbridge (oxfmt formatting, TypeScript and ESM, documentation beyond README.md).
- [template]: Update the plugin `verify-agent-context` skill to 1.0.4 (reports folder, worktree and branch first) and align every skill mirror description.
- [template]: Update the plugin `matterbridge.instructions.md` rule to 1.0.3 from matterbridge (Chapter 16 Camera devices from `matterbridge/devices/camera`).
- [template]: Update `AGENTS.md`, `AGENTS.plugin.md` and `CLAUDE.md` to 1.0.7 (run `npm run lint:fix` only when asked, matching the agent deny lists; `bun test` only through `npm run test:bun`; clearer `matterbridge` rule bullet).
- [template]: Update the testing rule to 1.0.7 (also names `*.spec.ts`, matching the globs of its Claude and Copilot pointers).
- [template]: Update `.agents/README.md` to 1.0.4 (where Copilot instruction and skill pointers keep their version, pointer file naming) and the `verify-agent-context` skill to 1.0.5 (mirrors defer to every step of the check).
- [upgrade]: Run `scripts/git-sync-dev.mjs` in the `git:merge:dev` and `git:rebase:dev` scripts (timestamped backup branch instead of the fixed `dev-backup-001`).
- [upgrade]: Drop Node.js 20 from `engines.node` (`>=22.13.0 <23.0.0 || >=24.0.0 <25.0.0 || >=26.0.0 <27.0.0`), matching matterbridge 3.11.0 and Vitest 5.
- [template]: Drop Node.js 20.19 from the supported versions in `AGENTS.md`/`AGENTS.plugin.md` and from the `build.yml` comment.
- [template]: Update `.codex/config.toml` to 1.0.6 with a comment that the `:workspace` default is intentional and the `matterbridge_safe`/`matterbridge_unsafe` profiles are opt-in.
- [template]: Update `.vscode/tasks.json` to 1.0.7: the Docker install tasks download the install script to a file and run it only after a complete download, instead of `curl | bash`.
- [package]: Bump `rollup` to v.4.65.0.
- [package]: Bump `oxfmt` to v.0.74.0.
- [package]: Bump `oxlint` to v.1.89.0.
- [package]: Bump `oxlint-tsgolint` to v.7.0.2005.

### Fixed

- [scripts]: Update `scripts/git-sync-dev.mjs` and its template to v.2.1.0: stop before the backup when `origin/dev` has commits that the local `dev` lacks, since the force push after the rebase dropped them (the fetch made `--force-with-lease` always pass), and add `--force-if-includes`.
- [upgrade]: Skip OS junk files (`.DS_Store`, `Thumbs.db`, `desktop.ini`) when copying template folders, so they no longer leak into packages.
- [template]: Fix `CODEOWNERS` to `* @Luligu`: the bare `@Luligu` line assigned no owner to any file.
- [scripts]: Update `scripts/prepublish-clean.mjs` and its template to v.2.2.0: reject unknown arguments (a mistyped `--dry-run` no longer deletes) and log every removed path with a final summary, like `clean.mjs` and `deep-clean.mjs`. Removal errors are warnings, so they never block the publish.
- [scripts]: `scripts/prepublish-clean.mjs` v.2.2.0 also deletes `devDependencies`, `scripts` and `automator` from package.json (and from every workspace with `--workspaces`, where the root also loses `workspaces`). It reads the workspaces before deleting the field.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [1.1.2] - 2026-10-18

### Added

- [esbuild]: Add the `obfuscate` keyword to `--esbuild`, which obfuscates every bundled JavaScript file with `javascript-obfuscator` (same settings as the vendored `scripts/esbuild.mjs`), keeping bin launcher shebangs.
- [pack]: Add the `obfuscate` keyword to `--pack`, passed through to the esbuild step.

### Changed

- [dts]: Bundle library declarations again with `rollup` and `rollup-plugin-dts` after the declaration-only emit, using `@typescript/typescript6` for the compiler API that TypeScript 7 removed.
- [package]: Add the `@typescript/native` alias of `typescript` 7 so `node_modules/.bin/tsc` runs TypeScript 7 instead of the TypeScript 6 pulled in by `@typescript/typescript6`.
- [esbuild]: Remove the per-file declarations superseded by the bundled declaration entries, so `dist` holds only bundled output.
- [pack]: Exclude the redirected source bin launchers from `files`, so they no longer ship in the tarball.
- [scripts]: Update `scripts/prepublish-clean.mjs` and its template to v.2.1.0: also remove `bun.lock`.
- [scripts]: Update `scripts/deep-clean.mjs` and its template to v.2.1.0: also remove the `tmp` directory.

### Fixed

- [pack]: Generate the shipped `npm-shrinkwrap.json` in an isolated temporary directory, so workspace links (npm 10) and `npm link` symlinks in `node_modules` no longer leak into it.
- [dts]: Bundle all declaration entries in one Rollup run with shared chunks in `dist/_chunks/`, so classes exported from several subpaths are declared once and stay assignable across them.
- [esbuild]: Keep every package import external unless it is a workspace package or listed in `automator.esbuild.bundle`, and warn about imported packages no `package.json` declares, instead of bundling a second copy of them.
- [dts]: Drop `--composite` (rejected by `tsc --build`, TS5094) and add `--force` to the monorepo declaration build, so monorepo libraries bundle again.
- [pack]: Keep the final newline when restoring `package.json` and `tsconfig*.json` files.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [1.1.1] - 2026-10-17

### Changed

- [template]: Update `vitest.config.ts` to 2.0.9 with a JUnit reporter writing `.cache/vitest/junit.xml`.
- [template]: Update `bunfig.toml` to 1.0.3 with `/**` directory ignore patterns and a JUnit reporter writing `.cache/bun/junit.xml`.

### Fixed

- [template]: Install optional frontend dependencies before plugin lint in CI, coverage and publish workflows.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [1.1.0] - 2026-10-16

### Added

- [upgrade]: Add the `bundle` and `obfuscate` scripts (esbuild, with `--declaration` for libraries) when `automator.bundle` / `automator.obfuscate` are enabled.
- [template]: Update `scripts/esbuild.mjs` to 2.0.0 with `--external`, `--entry-points`, `--dry-run`, `--version` and `--help` options.

### Changed

- [template]: Rename `.gitignore.txt`, `.oxfmtrc.root.json` and `.oxlintrc.root.json` to `.gitignore.template`, `.oxfmtrc.json.template` and `.oxlintrc.json.template`.
- [upgrade]: Merge `automator.ignore.git`, `automator.ignore.oxfmt`, `automator.ignore.oxlint` and `automator.ignore.vitest` into `.gitignore`, `.oxfmtrc.json`, `.oxlintrc.json` and `vitest.config.ts`.
- [upgrade]: Update `.vscode/tasks.json` between the `DO NOT EDIT` markers from `template/.vscode/tasks.json` when `.vscode/tasks.json` already exists.
- [upgrade]: Remove `scripts/bun-bundle.mjs` when `automator.bun` is not enabled.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [1.0.4] - 2026-10-03

### Changed

- [upgrade]: Replace the legacy `vite.config.ts` with `vitest.config.ts` and update test-runner detection.
- [template]: Rename the bundled vendor directory to template and update runtime paths, package files and exclusions.
- [upgrade]: Merge local `.oxfmtignore` and `.oxlintignore` patterns into the generated configurations.

### Fixed

- [devcontainer]: Remove the `apps/frontend/node_modules` volume from the plugin `devcontainer.json` files (node and bun) when the plugin has no `apps/frontend/package.json`, so Docker no longer creates an empty `apps/frontend` in the workspace.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [1.0.3] - 2026-10-02

### Added

- [scripts]: Sync the own and vendored `scripts/*.mjs` to v.2.0.0 from matterbridge-native (adds `--help`, `--version` and `--dry-run` to `git-sync-dev.mjs`) and add `bun-bundle.mjs`.

### Fixed

- [oxc]: Exclude `scripts` directories from the vendored root lint and format configs.
- [upgrade]: Drop the npm-only `--no-fund --no-audit` flags from `bun link matterbridge` in the plugin `softReset:bun` script.
- [scripts]: Bump the vendored `scripts/clean.mjs` and `scripts/deep-clean.mjs` to v.1.3.1, which warn on unreadable paths instead of silently skipping them.
- [scripts]: Sync the own and vendored `scripts/*.mjs` with the latest versions from matterbridge-native (`clean.mjs` and `deep-clean.mjs` v.1.4.0, `prepublish-clean.mjs` v.1.2.0, the others v.1.1.0).
- [vendor]: Add the matterbridge-native exclusions (`artifacts`, `chip`, `tmp`, `.hutch`, `.cottontail-tmp`, plus `xmls` for oxc) to the vendored `.gitignore` v.1.0.4, `.oxfmtrc.json` v.1.0.8 and `.oxlintrc.json` v.1.0.20.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [1.0.2] - 2026-09-29

### Added

- [devcontainer]: Add [`Dev Container`](.devcontainer/README.md) v.2.2.0 with dual Node and Bun runtime support.
- [agents]: Add a [`shared setup`](.agents/README.md) for all agents: OpenAI Codex, Claude Code, GitHub Copilot and Google Gemini / Antigravity.
- [upgrade]: Add `automator.skipPublishWorkflow` to remove `.github/workflows/publish.yml` after the copy, for repositories that are never published to npm.
- [vscode]: Add `.github/commit-message-instructions.md` and point the VS Code Copilot "Generate Commit Message" button to it (`settings.json` v.1.0.13) for Conventional Commits.
- [styleguide]: Link the Conventional Commits spec and `.github/commit-message-instructions.md` in section 13 of the vendored `STYLEGUIDE.md`.
- [styleguide]: Add a Changelog section to the vendored `STYLEGUIDE.md`: Keep a Changelog format and Semantic Versioning, as stated in every fleet `CHANGELOG.md`.
- [version]: Add `--version` and `-v` to print the mb-run version. It works outside a package root and never changes any file.
- [scripts]: Bump the vendored `scripts/clean.mjs` and `scripts/deep-clean.mjs` to v.1.3.0, which log every removed path and a final summary with the elapsed time, add `--help` and `--version`, and reject unknown arguments.
- [upgrade]: Install `@typescript/typescript6`, `rollup` and `rollup-plugin-dts` alongside `esbuild` when `automator.bundle` is set. `rollup-plugin-dts` bundles the declarations through the legacy compiler API that TypeScript 7 (tsgo) removed, and its optional peer `@typescript/typescript6` supplies that API next to the `typescript` 7 used for the build.

### Fixed

- [styleguide]: Bump the vendored `STYLEGUIDE.md` to v.1.1.0 and audit it against the fleet config: fix the lux example (`+ 1`, no negative values), the import order, align commit types, JSDoc and file headers with lint and apply-style, replace the Copilot hints with an Agents section, and scope Matterbridge-only rules.
- [esbuild]: Bump the vendored `scripts/esbuild.mjs` to v.1.0.2, which logs each obfuscated file. With the declaration bundling dependencies now installed, `npm run bundle` and `npm run obfuscate` work again under tsgo.
- [upgrade]: Install `@types/node` unpinned again. DefinitelyTyped no longer lets the last published Node.js line take over the `latest` dist-tag, so the `@types/node@24` pin on the LTS major is obsolete and was already being superseded by the `ncu -u` pass of `--update`.
- [upgrade]: Select the Matterbridge rules by package name instead of by `isMonorepo`. Any repository with a `workspaces` field was treated as the Matterbridge monorepo and received the plugin variants of `.agents`, `.claude`, `.github` and `AGENTS.md`, pulling the `matterbridge`, `plugin-frontend` and `chip-tests` rules, the plugin workflows and the plugin issue template into unrelated monorepos.
- [upgrade]: Keep the scripts of a workspace package when it sets `automator.skipPackageJson`. Workspace packages that own their scripts, such as an Electron app with its `electron-builder` targets, lost them on every upgrade.

### Changed

- [antigravity]: Bump the vendored `.antigravity/settings.json` to v.1.0.5: count the removed sandboxing comments and allow the read-only git commands already approved in `.vscode/settings.json`.
- [vscode]: Bump the vendored `.vscode/settings.json` to v.1.0.14: ask before dependency installs and removals and approve `npm run test:watch` and `npm run test:verbose`, in sync with `.antigravity/settings.json`.
- [scripts]: Remove the obsolete `eslint-disable` comments from the vendored `scripts/*.mjs` and bump each touched script's patch version.
- [scripts]: Make the vendored `scripts/*.mjs` pass oxlint: file-level `no-console` disables, behavior-preserving fixes, and local disables where a fix would change runtime behavior.
- [esbuild]: Make the vendored `scripts/esbuild.mjs` pass oxlint: file-level `no-console` disable, JSDoc descriptions and an optional chain.
- [oxlint]: Bump the vendored `.oxlintrc.root.json` to v.1.0.19: lint `scripts/` and `bin/`, and ignore `docs/**`, `**/tmp/**` and `**/bun.lock`.
- [oxfmt]: Bump the vendored `.oxfmtrc.root.json` to v.1.0.7: ignore `docs/**`, `**/tmp/**` and `**/bun.lock`, and drop the `scripts/*.html` and `eslint.config.js` ignores.
- [scripts]: Remove the unused vendored `scripts/run-automator.mjs`, which every upgrade deleted right after copying it.
- [upgrade]: Delete the obsolete `scripts/install-experimental.mjs` from upgraded repositories.
- [version]: Breaking change: rename `--version [tag]` to `--set-version [tag]`, so `--version` no longer rewrites `package.json`. The old `mb-run --version <tag>` form exits with an error pointing to `--set-version`.
- [package]: Upgrade package.
- [package]: Bump `oxfmt` to v.0.71.0.
- [package]: Bump `oxlint` to v.1.86.0.
- [package]: Bump `oxlint-tsgolint` to v.7.0.2003.
- [package]: Bump `vitest` to v.5.0.2.
- [package]: Bump `@vitest/coverage-v8` to v.5.0.2.
- [package]: Bump `@types/node` to v.26.6.3.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [1.0.1] - 2026-09-12

### Added

- [agents]: Add the shared agent stack to the vendor directory: `.agents` is now the single source of truth (`.agents/README.md`, `.agents/rules/<topic>.instructions.md`, `.agents/skills/<name>/SKILL.md`), with `.agents-plugin` and `.claude-plugin` holding the plugin variants next to the existing `.github-plugin`.
- [agents]: Add the `verify-agent-context` skill, mirrored as a pointer in `.claude/skills` and `.github/skills`.
- [agents]: Add Gemini / Antigravity support with `GEMINI.md` and `.antigravity/settings.json` v.1.0.0.

### Fixed

- [upgrade]: Pin `@types/node` to the active Node.js LTS major (`@types/node@24`) instead of installing it unpinned. DefinitelyTyped maintains several Node.js lines in parallel and publishes them newest first, so the oldest maintained line is published last and takes over the `latest` dist-tag: resolving `latest` returned a different line depending on the day, and `--save-exact` froze that arbitrary value into every repository.

### Changed

- [agents]: Turn `.claude/rules`, `.claude/skills`, `.github/instructions` and `.github/skills` into pointers to `.agents`, so guidance is written once and never copied.
- [agents]: Turn `CLAUDE.md` v.1.0.3, `GEMINI.md` and `.github/copilot-instructions.md` v.1.0.3 into thin entry points that read `AGENTS.md` v.1.0.3.
- [agents]: Require an explicit confirmation for `mb-run` in every shape (`mb-run`, `npx mb-run`, `bunx mb-run`) across `.claude/settings.json` v.1.0.8, `.codex/rules/default.rules` v.1.0.5, `.antigravity/settings.json` v.1.0.1 and `.vscode/settings.json` v.1.0.12: it rewrites vendored files and `package.json`.
- [agents]: Add the hard rule that `tsc`, `vitest`, `oxlint` and `oxfmt` are never invoked directly, and enforce it in `.claude/settings.json` v.1.0.7, `.codex/rules/default.rules` v.1.0.4, `.antigravity/settings.json` and `.vscode/settings.json` v.1.0.11.
- [vscode]: Enable `chat.useAgentsMdFile` and `chat.useNestedAgentsMdFiles` in `.vscode/settings.json` so VS Code loads `AGENTS.md` as always-on instructions, and align `chat.tools.terminal.autoApprove` with the other agents.
- [upgrade]: Select the plugin or the plain variant of `.agents` and `.claude` instead of copying one set and deleting the extra files afterwards, and remove the files left over from the previous layout.
- [agents]: Scope the Matterbridge endpoint rule to `src/module.ts` (`paths:` for Claude Code, `applyTo:` for Copilot) so it auto-loads on a plugin's entry point: it was the only rule with no trigger declared, which left it never applied now that the mirrors are pointers.
- [upgrade]: Append `localAgents.md` to `AGENTS.md` only. `CLAUDE.md` and `GEMINI.md` now read it through `@AGENTS.md` and Copilot loads `AGENTS.md` natively, so the previous extra appends to `CLAUDE.md`, `GEMINI.md` and `.github/copilot-instructions.md` would duplicate the repository-local guidance.
- [github]: Quote the `.github/ISSUE_TEMPLATE` front matter with single quotes so it matches what oxfmt produces. The plain copies used double quotes while the `.github-plugin` copies already used single quotes, so every non-plugin repository was handed files the formatter rewrote on arrival.
- [vscode]: Rename the vendored `.vscode/settings.native.json` and `.vscode/extensions.native.json` to `settings.json` and `extensions.json`, and drop the stale eslint/prettier copies they shadowed: only the native pair was ever copied.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [1.0.0] - 2026-08-29

### Added

- [bun]: Add Bun version, install, binary, cache, and global module information to `--info`, including the related environment variable values.
- [self]: Check npm in a background worker for newer mb-run releases and log a warning when an update is available.
- [install]: Extract dependency installation and Matterbridge plugin linking into `runInstall()`.
- [devcontainer]: Add Dev Container (Bun and Node) v.2.0.0.

### Changed

- [devcontainer]: Bump Dev Container config to v.1.2.0.
- [dts]: Replace third-party declaration bundling with TypeScript declaration-only emit while TypeScript 7-compatible bundlers are unavailable.
- [build]: Drop the `tsgo` native preview compiler; `--build`, `--typecheck`, and `--watch` now always use `tsc`.
- [lint]: Bump the Oxc toolchain (`oxlint`, `oxfmt`, `oxlint-tsgolint`) and disable the new `node/no-top-level-await` rule, since the Matterbridge ecosystem is pure ESM with no `require(esm)` consumers.
- [package]: Bump `oxfmt` to v.0.65.0.
- [package]: Bump `oxlint` to v.1.80.0.
- [package]: Bump `@types/node` to v.26.4.0.
- [package]: Bump `esbuild` to v.0.28.2.
- [package]: Bump `npm-check-updates` to v.23.1.0.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [0.0.5] - 2026-07-12

### Added

- [automator]: Add `app` flag to signal an app package, skipping the `scripts` folder copy, tsconfig modifications, script field setup, and the required `engines` field warning.
- [automator]: Add `skipPackageJson` flag to skip package.json script field setup and `npm pkg set` updates.
- [automator]: Add `skipTsconfig` flag to skip tsconfig file modifications.
- [automator]: Add `skipDevContainer` flag to skip the `.devcontainer` copy.
- [automator]: Add `private` flag to skip the required package.json field warnings (homepage, main, types, exports, bugs, funding, keywords) and the CODE_OF_CONDUCT.md, CONTRIBUTING.md, and LICENSE copy for private packages.
- [automator]: Add `jestTypes` and `vitestTypes` flags to install `@types/jest` and `vitest` type packages independently of the Jest/Vitest test runners.
- [automator]: Add `bundle` and `obfuscate` overrides to enable bundling and obfuscation from package.json.

### Changed

- [automator]: Workspace packages now run `npm install`/`npm prune` from the monorepo root instead of installing devDependencies per package.
- [package]: Update agents instructions.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [0.0.4] - 2026-07-08

### Added

- [typescript]: Hold typescript to 6.0.3 for other packages compatibility and keep tsgo.

### Changed

- [package]: Update agents instructions.
- [package]: Update dependencies.
- [package]: Upgrade package.
- [codex]: Update codex configuration.
- [vscode]: Update vscode extensions.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [0.0.3] - 2026-07-06

### Added

- [copilot]: Update VS Code settings to version 1.0.7 and add terminal auto-approve configurations.
- [claude]: Update Claude settings to version 1.0.4 and add terminal auto-approve configurations.
- [package]: Apply style.

### Changed

- [package]: Update dependencies.
- [workflows]: Set node-version matrix back to: [22.x, 24.x, 26.x].
- [package]: Add vendor to files.

### Fix

- [claude]: Fix malformed settings.json.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [0.0.2] - 2026-07-01

### Added

- [upgrade]: Add bun and buntest to upgrade.

### Changed

- [package]: Update dependencies.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [0.0.1] - 2026-06-27

- [package]: Initial release.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="80"></a>
