# Dependency security review, 15 October 2026

## Narrow Istanbul/YAML change

The installed `babel-plugin-istanbul@8.0.0` uses
`@istanbuljs/load-nyc-config@1.1.0`, whose published package requires
`js-yaml@^3.13.1`. That resolves to `js-yaml@3.15.2`, `argparse@1.0.10`,
and `sprintf-js@1.0.3` in the previous lockfile. The scoped npm override
selects `js-yaml@4.3.2` **only** under `@istanbuljs/load-nyc-config`; the
revised lockfile no longer contains `sprintf-js`. These are development/test
dependencies, not application imports. The `sprintf-js` advisory
[GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
affects versions through 1.1.3 and lists no patched release.

This override crosses the parent's declared major-version range and is a
reviewed compatibility workaround, **not an upstream-supported parent
upgrade**. The installed parent calls `require('js-yaml').load` for `.yml`
and `.yaml`; that API exists in v4. The repository has no `.nycrc` file.
Its Jest runner, ESLint, TypeScript, Prisma generation, production Next build,
standalone HTTP smoke, and a regression loading a representative `.nycrc.yml`
were tested after a clean `npm ci` on Node 24. Arbitrary external YAML
configurations have not been exhaustively tested; v4 changes parsing semantics.
If an upstream release removes this dependency chain, remove the override and
regenerate the lockfile. If the compatibility regression fails, revert this
four-file change and restore the previous lockfile; do not disable security
checks to conceal a failure.

## Audit scope and remaining gate

Two local, same-session audit captures made by the dependency-review worker
showed 26 affected dependency nodes (7 high, 19 moderate) on the prior lock
and 7 (7 high, 0 moderate) on this candidate. These counts describe npm
dependency nodes, not distinct exploitable application paths. Another earlier
audit counted the Tailwind peer node differently, so its totals must not be
treated as a comparable baseline. A separate fresh registry audit of the
integration lock was denied by tooling; it was not rerun via another route.
The compared lockfile SHA-256 values are
`aeaa3e6ee34f63269327a811f955c474b95e6fca9a489df3959faf3640665788`
(prior) and
`9fa1938f3b4eae214552e36540f9ef64d57201e8483b81095793af365a8c80ae`
(candidate).

The remaining high nodes trace to `braces@3.0.3` through Tailwind 3 and
Next's ESLint chain. [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
lists no patched release. Tailwind 4 requires a CSS/PostCSS and browser
regression migration and does not by itself remove the ESLint branch.
The strict audit CI gate remains required and may fail until a supported
upstream fix or independently reviewed migration removes the vulnerable
dependency. No runtime non-reachability claim is proven by this audit.

## Verification on this candidate

- Clean `npm ci --no-audit --no-fund` with lifecycle scripts and Prisma generation: passed
- SQLite Prisma generation followed by full Jest: 130 suites, 1,079 tests passed,
  including both new focused dependency regressions
- ESLint with zero warnings, TypeScript, PostgreSQL Prisma generation: passed
- Physical Next standalone production build and 11 HTTP smoke checks: passed
- Disposable `loadNycConfig` runs for default and representative YAML config:
  old and revised lockfiles returned equivalent results for those cases
- Real-browser, live PostgreSQL, and final remote CI acceptance remain open

The affected released parent is documented by the
[npm-published package metadata](https://www.npmjs.com/package/@istanbuljs/load-nyc-config/v/1.1.0).
Its unreleased repository default branch may differ; do not assume that branch
has been published to npm.
