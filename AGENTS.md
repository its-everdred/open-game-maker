# Open Game Maker 2000: operating notes for coding agents

## Commands

- Install exactly from the lockfile: `pnpm install --frozen-lockfile`.
- Before committing, run `pnpm exec prettier --write <changed files>`; the installed pre-commit hook also formats and re-stages staged files.
- Run the repository gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- Test one package with `pnpm --filter @ogm/<pkg> test`; Python workers use `make test` after OGM-009.
- Browser tests use Playwright on Chromium with `--use-angle=gl-egl --enable-gpu --ignore-gpu-blocklist`; set
  `GM_VERIFY_SOFTWARE_GL=1` for SwiftShader (CI does).

## Layout

Product code lives in `apps/*`, `packages/*`, `services/*`, `skills/*`, `templates/*`, `scripts/py/*`, and `ops/`
(see `docs/plans/ogm-v1-build/architecture.md` §2 on the `research` branch). Package names are `@ogm/<dir>`;
the engine-side exceptions are `@gm/sdk` and `@gm/host`.
Setting up a host: `SETUP.md` (generated from `apps/site/content/setup.yaml`; edit the YAML).

## New package

A package has `package.json` scripts `build: tsc -b`, `typecheck: tsc -p tsconfig.json --noEmit`, `test: vitest run`,
`lint: eslint src`, and a `tsconfig.json` that extends `../../tsconfig.base.json` with `rootDir: src`, `outDir: dist` and
`references` to its workspace dependencies. Adding a package needs no root edits: the workspace globs pick it up.

## Write-surface rules

- Do not edit the root `package.json` except to add a workspace script; packages own their dependencies and scripts.
- Keep one contract family per file in `packages/contracts/src`; `src/index.ts` is append-only.
- Commands, routes, and screens are directory-scanned; migrations are timestamped files.
- `.aiur/config`, `CODEOWNERS`, `.gitignore`, and `ci.yml` are Executor-owned shared surfaces.

## Services

Bind services to `127.0.0.1` only. Read environment values by name through `@ogm/config` and never log a value.
Secrets live in `~/.config/ogm/env/<unit>.env` with mode `0600`. Do not add provider API keys or authorize spending.

## Dependencies

Pin exact versions. A new dependency with fewer than 1,000 GitHub stars needs the exception named in the PR.

## Tests

Use Vitest for unit tests. Every new test must fail without the production change. Run browser tests with the flags above.
Builder fleet test helpers may read `OGM_TEST_HOME` and `TMPDIR` directly to keep scratch homes under a chosen writable
directory.
A package `test` script must find at least one test file (or pass `--passWithNoTests`): `vitest run` with none exits 1 and
turns `ci / required` red.

## Pull requests

Start the body with `Closes #<issue>`. Include `## Local tests` with Policy, a 40-character Tested head SHA, Base as
`<ref> @ <sha>`, Selection, and one bullet per command with its result. Update the evidence after every push.

Before opening a PR, run the `ce-code-review` skill on the branch's full diff against `main`, fix every finding it rates blocking, and add a `## Review` section to the body: the personas that ran, each blocking finding with the commit that fixed it, and the non-blocking findings left with a one-line reason each. The Executor only checks that the PR does what its ticket says; a PR without `## Review` is sent back unread.
Adapter PRs add `## Promote`, naming any proposed L3→L2 or L2→L1 move with its rule-of-two evidence, or `None`.
For `packages/pack-adapters/*`, check: themeless exports, required tunables, no gameplay/UI/content, synthetic fixtures, verified conventions, binds/leaves README, and both scaffolds green.

## Never commit

Never commit `assets-local/`, keys, download links, licence serials, or `prototypes/ui-v0/tools/_pf.mjs`. Prototypes are
frozen. Deploys are manual because Netlify credits are limited.
