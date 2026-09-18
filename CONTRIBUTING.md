# Contributing

Thanks for taking an interest. This is a small project, so the process is short.

## Getting set up

```bash
npm ci
npm run build
npm test
```

Node 20 and npm 10 are what CI uses. The Angular 17 toolchain that builds the packages is not
validated on newer Node, so if a build fails oddly, check your Node version first.

## The gates

Everything CI enforces, you can run locally:

| Command | What it checks |
|---|---|
| `npm run lint` | Control characters, build order, extension-point coverage, eslint, and each package's typecheck |
| `npm run check:build-graph` | Every sibling a package imports is one turbo will build first |
| `npm run build` | All five packages via turbo |
| `npm test` | Unit tests |
| `npm run test:coverage` | Coverage thresholds — a ratchet, see below |
| `npm run check:timezones` | Runs the date-sensitive suites once per timezone |
| `npm run e2e` | Playwright, against the demo app |
| `node scripts/verify-consumer.mjs --angular 20` | Packs the tarballs, installs them into a throwaway Angular project, and AOT-compiles a consumer |
| `node scripts/verify-consumer.mjs --angular 20 --readme` | Compiles every documented code block |
| `node scripts/verify-consumer.mjs --angular 20 --ssr` | Packs the tarballs and `renderApplication`s a form on `@angular/platform-server` |
| `node scripts/verify-consumer.mjs --angular 20 --ssr --zoneless` | Same, under `provideZonelessChangeDetection()` with no `zone.js` |
| `node scripts/verify-server-consumer.mjs` | Packs `@dynamic-entity/server`, installs it into a throwaway **Node** project, imports it as both CJS and ESM, drives all four routes against a real listener, and compiles the package README's snippets |

The last two are worth knowing about. The workspace build cannot catch packaging faults —
inside the repo everything resolves through symlinks and tsconfig paths, so a broken manifest
still appears to work. Those scripts are what prove an actual consumer can install and compile,
and they are two scripts rather than one because an Angular consumer and a Node consumer break
in different ways: one fails to AOT-compile a template, the other fails to resolve an `exports`
subpath.

## Things that will fail review

- **A claim in a README that the code does not back.** Every fenced `typescript` and `html`
  block is extracted and compiled in CI. If a snippet is a fragment that cannot compile,
  fence it as `ts` and it will be skipped — see the note at the top of `EXTENDING.md`.
- **Lowering a coverage threshold to make a change pass.** The numbers sit just under what
  each package actually achieves so a regression fails. Raise them when coverage improves.
  They are **per-file**, not aggregate, and there is no `global` entry on purpose — Jest
  removes glob-matched files from the `global` group, so a `./src/**/*.ts` key next to a
  `global` key silently leaves the latter measuring nothing. Per-file is also the stronger
  gate: no single rotting file can hide behind the average.
- **Reading a date through `new Date` when it has no time.** `new Date('2024-03-07')` is UTC
  midnight, so formatting it back with local getters moves it a day earlier everywhere west
  of Greenwich. Parse the text; `new Date` is for a `datetime`, which genuinely is an instant.
  `npm run check:timezones` is what catches this — CI runs UTC and cannot.
- **A test that cannot fail.** If you add a guard, check that reintroducing the bug it guards
  against actually breaks the test.
- **A new field type without a catalog entry**, or a catalog entry without a component. The
  two registries are independent by design; both need updating. See `EXTENDING.md`.

## Commits

Conventional-commit prefixes (`fix:`, `feat:`, `docs:`, `ci:`, `test:`, `build:`), with a
scope where it helps (`fix(renderer):`). Explain *why* in the body, not just what — the
existing history is the guide.

## Releasing

Maintainers only, and mostly automatic:

1. Bump the version in all four package manifests, and `CORE_VERSION` in
   `packages/core/src/constants.ts` alongside them. They share a version, and the build
   refuses to publish core when the constant and its manifest disagree — it is compared
   across a network, so a stale one would report agreement between two engines that had
   diverged.
2. Add a `CHANGELOG.md` entry.
3. Tag `vX.Y.Z` and push it.

The Release workflow re-runs every gate, verifies the tag matches the manifests, and publishes
core → renderer → builder in that order (each peer-depends on the previous), then
`@dynamic-entity/server`, which peer-depends only on core and is independent of the Angular
two. Authentication is npm trusted publishing via OIDC — there is no token to manage.
Publishing a version that is already on the registry is a no-op rather than a failure, so
re-running a release is safe.

It also checks that every package already exists on the registry before it publishes any of
them. A package being released for the very first time needs one manual publish first — see
below for why, and for the five values the trusted publisher needs.

### Adding a fourth (or fifth) published package

**A package that has never been published cannot be released by the Release workflow**, and
that is a limitation of the registry rather than of this repository. Trusted publishing is
configured in a package's settings on npmjs.com, which requires the package to exist. npm has
no "pending" trusted publisher for a name that is not on the registry yet — PyPI has one, npm
does not — so a new name cannot be configured before it exists and cannot be published by OIDC
before it is configured.

The Release workflow checks for this **before it publishes anything**, so a first release fails
whole rather than leaving three packages at a version the fourth never reached.

The way through is one manual publish, once, per new package:

1. **Publish the name by hand, from a clean checkout at the release commit.**

   ```bash
   npm run build
   npm login                     # the 2FA prompt is the point — no token is stored
   npm publish ./packages/server/dist --access public
   ```

   `--access public` is required: a scoped package defaults to restricted, and publishing it
   private looks exactly like success. Publish the built `dist/`, never the package root — the
   manifest a consumer gets is written by `build-manifest.mjs`.

   No provenance attestation on this one publish, because provenance comes from the workflow.
   Every later release has it.

2. **Configure the trusted publisher**, now that the package exists. On npmjs.com → the
   package → Settings → Trusted Publisher, with exactly these values:

   | Field | Value |
   |---|---|
   | Publisher | GitHub Actions |
   | Organization or user | `berserker5619` |
   | Repository | `Dynamic-Entity` |
   | Workflow filename | `release.yml` |
   | Environment | `npm` |

   The environment is not optional here: `release.yml` declares `environment: npm`, and a
   configuration that omits it will not match the token the workflow presents. npm does not
   verify any of this when you save it — a wrong value fails at the next publish, not now.

3. **Check it before you need it.** Run the Release workflow by hand with `dry_run: true`. It
   runs every gate and packs the tarballs without publishing, which is how you find out that
   step 2 was wrong while it is still cheap.

4. **Add the package to the release plumbing** if it is not there already: the tag-vs-manifest
   loop, a publish step, the dry-run pack list, and a consumer verification script of the right
   shape — `verify-consumer.mjs` for an Angular package, `verify-server-consumer.mjs` for a
   Node one. They break differently, which is why there are two.

**Why not a bootstrap workflow with a token.** The obvious alternative is a second,
`workflow_dispatch`-only workflow holding an `NPM_TOKEN`. It would make step 1 a button rather
than a terminal. It would also put a long-lived publish credential back in this repository,
which the Release workflow's header explains at length was removed on purpose — and it would
sit there for years to save a maintainer one command they run once per package. A local publish
behind the account's own 2FA leaves nothing behind.

## Reporting something

Use the issue templates. For anything security-related, see [SECURITY.md](SECURITY.md) — please
do not open a public issue.
