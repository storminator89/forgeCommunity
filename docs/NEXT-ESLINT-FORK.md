# Pinned Next ESLint plugin fork

## Scope and provenance

This repository temporarily owns a local package for `@next/eslint-plugin-next@16.3.8` while the upstream package still depends on `fast-glob@3.3.1`, which reaches the unpatched `braces@3.0.3` advisory. The source is the published Next.js 16.3.8 plugin distribution (`@next/eslint-plugin-next` npm tarball integrity `sha512-eCR9RcLTZrVS+K3+VOhi0xMdUUGNuriCHHhU1ZoABC/QQ/Gp0OWbLKQxV2/9DkmihYdYRcQWFmZXW8M1AMUXYw==`); [upstream package](https://github.com/vercel/next.js/tree/v16.3.8/packages/eslint-plugin-next). Next.js's MIT notice is retained in `vendor/next-eslint-plugin-next/LICENSE`.

The sole runtime edit is `dist/utils/get-root-dirs.js`. It replaces `fast-glob` with a compatibility adapter over `tinyglobby@0.2.15`, preserving `settings.next.rootDir` behavior for absent/default settings, literal and missing paths, directory globs and globstars, arrays, absolute paths, and Windows-style separators. All other 53 distributed JS/type files are byte-identical to the official package, with hashes in `vendor/next-eslint-plugin-next/UPSTREAM_SHA256.json`. The fork's manifest removes `fast-glob`, pins `tinyglobby`, and marks the package private. No Next rule implementation, rule identity, or recommended/Core Web Vitals severity is changed.

The package in `package.json` is the checked-in `vendor/next-eslint-plugin-next-16.3.8.tgz`, built from the checked-in source directory. Its `file:` resolution and SHA-512 integrity are in `package-lock.json`; this is a direct dev dependency so npm deduplicates `eslint-config-next`'s exact 16.3.8 requirement to the local archive. A local `overrides` file path was rejected because npm 11 generated a nested broken link relative to `eslint-config-next`, despite removing the vulnerable branch from lock. Do not reintroduce that form without a clean-install proof.

## Verification and maintenance

Run `node scripts/check-next-eslint-chain.js` to verify the lock, archive integrity, and absence of any nested official plugin. After a clean `npm ci`, run `npm run test:next-eslint-fork` to verify the installed package and compare rule IDs, configs, severities, rootDir results, and diagnostic messages against a fixture snapshot captured from the unmodified official 16.3.8 package. The quality CI job runs this test; the existing independent `security-audit` and `validate` jobs remain required. Full lint, types, tests, build, browser QA, and the ordinary CI audit still apply. This fork does not alone remove Tailwind 3's separate `braces` paths.

To rebuild the archive after an intentional source change:

1. Review the diff from the official source and update the baseline only if a Next upgrade deliberately changes the rule contract.
2. Run `npm pack ./vendor/next-eslint-plugin-next --pack-destination ./vendor --ignore-scripts` using the pinned npm toolchain. Confirm the archive contains LICENSE, README, manifest, and dist files only.
3. Remove the stale `node_modules/@next/eslint-plugin-next` entry from `package-lock.json`, then run `npm install --package-lock-only --ignore-scripts --no-audit`; npm otherwise retains the old local archive integrity when its filename is unchanged.
4. Run the guard, clean install, parity test, and full CI matrix. Never suppress or omit the audit.

When an official stable Next plugin release removes the affected dependency, retire the fork: update `next` and `eslint-config-next` together, delete the local plugin dev dependency and checked-in vendor source/archive, regenerate the lock, and prove the exact published dependency chain, lint parity, and CI audit on the replacement. If the adapter regresses, roll back this isolated lint change and keep the security release gate blocked until another genuine remediation is validated. Do not replace the archive with the official 16.3.8 package or waive the advisory.
