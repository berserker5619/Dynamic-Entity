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
| `npm run lint` | Control characters, eslint, and each package's typecheck |
| `npm run build` | All four packages via turbo |
| `npm test` | Unit tests |
| `npm run test:coverage` | Coverage thresholds — a ratchet, see below |
| `npm run e2e` | Playwright, against the demo app |
| `node scripts/verify-consumer.mjs --angular 20` | Packs the tarballs, installs them into a throwaway Angular project, and AOT-compiles a consumer |
| `node scripts/verify-consumer.mjs --angular 20 --readme` | Compiles every documented code block |

The last one is worth knowing about. The workspace build cannot catch packaging faults —
inside the repo everything resolves through symlinks and tsconfig paths, so a broken manifest
still appears to work. That script is what proves an actual consumer can install and compile.

## Things that will fail review

- **A claim in a README that the code does not back.** Every fenced `typescript` and `html`
  block is extracted and compiled in CI. If a snippet is a fragment that cannot compile,
  fence it as `ts` and it will be skipped — see the note at the top of `EXTENDING.md`.
- **Lowering a coverage threshold to make a change pass.** The numbers sit just under what
  each package actually achieves so a regression fails. Raise them when coverage improves.
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

1. Bump the version in all three package manifests. They share a version.
2. Add a `CHANGELOG.md` entry.
3. Tag `vX.Y.Z` and push it.

The Release workflow re-runs every gate, verifies the tag matches the manifests, and publishes
core → renderer → builder in that order (each peer-depends on the previous). Authentication is
npm trusted publishing via OIDC — there is no token to manage. Publishing a version that is
already on the registry is a no-op rather than a failure, so re-running a release is safe.

## Reporting something

Use the issue templates. For anything security-related, see [SECURITY.md](SECURITY.md) — please
do not open a public issue.
