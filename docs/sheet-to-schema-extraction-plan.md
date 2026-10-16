# Plan: moving sheet-to-schema to its own repository

Status: **Stage 1 of 4, plan only.** Nothing has been changed except this file.

Target: `github.com/berserker5619/sheet-to-schema`, history preserved. Dynamic Entity (DE)
then depends on it as a package: the exact rc version until the finals, `^1.0.0` from then on.

The four stages, each ending in a stop for the owner's go:

| Stage | What | Publishes? |
|---|---|---|
| 1 | This document | no |
| 2 | Build the new repository; CI green; owner switches the npm trusted publisher | no |
| 3 | Tag `v1.0.0-rc.3` in the new repository; it must publish through CI | `sheet-to-schema@1.0.0-rc.3` |
| 4 | Switch DE over: remove the workspace, pin rc.3, drift workflow, Dependabot, docs, `3.0.0-rc.3` | no (stops before tagging) |

How to read the tables: **Copy** means the file moves to the new repository unchanged (or with
only a comment touched). **Rewrite** means it exists on both sides but has to change.
**Leave** means it stays in DE and the new repository has no use for it.

---

## 1. What this inventory found

Five findings differ from what the brief assumed. They change the work, so they come first.

1. **The package reaches outside its own folder for nothing.** No file under
   `packages/sheet-to-schema` imports another package, a root config, or anything in
   `packages/core/test-fixtures`. Its `tsconfig.json` has no `extends`; its Jest config is
   self-contained. An ESLint rule (`eslint.config.mjs:136-190`) already forbids `../../*` and
   `@dynamic-entity/*` imports in it. The extraction is mostly a move, not an untangling.
2. **The shared fixtures flow the other way.** `core/test-fixtures` (`preview-parity.ts`,
   `xlsx-parity.ts`, `problem-fixtures.ts`, `import-golden-2.5.0.json`, the three `.xlsx`
   cases, `generate-fixtures.mjs`) is consumed only by DE's `core`, `server` and
   `ngx-dynamic-entity` specs. The `order` and `student` fixtures the brief lists are already
   inside the package, at `packages/sheet-to-schema/test/fixtures/`.
3. **History needs two paths, not one.** The package lived at `packages/sheet-importer` until
   commit `420eec6` (2026-10-11). `--subdirectory-filter packages/sheet-to-schema` alone would
   keep 30 commits and turn all of Phase 1 (13 commits, `f955f56` onward, 2026-10-10) into one
   "add everything" commit. The filter must follow both paths. See section 5.
4. **After the split, nothing in the new repository would read a real `.xlsx` for the three
   hard cases.** A grep of the package's source finds no `1904`, no merged-cell and no
   `date1904` handling under test. Those behaviours (1904 date system, numeric identifiers
   past 2^53, merged header / hidden column / formula / duplicate header) are held today only
   by DE's `real-world-fixtures.spec.ts`, which runs them through `sheet-to-schema/node`.
   Once the packages are in different repositories, a regression in the engine would be seen
   first by the daily drift job in DE, not by the engine's own CI. See decision D1.
5. **Two things can fail at the end rather than the start**: the server's Jest suites depend
   on reading the package from source (risk R1), and the Dependabot request collides with a
   Dependabot rule (risk R2). Both are in section 7 with how to find out early.

---

## 2. Root configs it inherits

| Item | Where | Action | Notes |
|---|---|---|---|
| `tsconfig.json` | package | **Copy** | No `extends`. Keep the `paths` entry `sheet-to-schema -> ./src/index.ts`: `/node` imports the main entry by the package's own name. |
| `jest.config.js` | package | **Copy** | Coverage thresholds live here (95/90/100/95 for `src/*.ts`, 90/80/100/90 for `src/node/**`). One comment points at `packages/core/jest.config.js`; reword it to stand alone. |
| `tsup.config.ts` | package | **Copy** | One comment cites `docs/phase2-plan.md`; make it a full URL to the DE repository. |
| `package.json` | package | **Rewrite** | Version `1.0.0-rc.3`; `repository`, `homepage`, `bugs` to the new repository (drop `directory`); `lint` becomes `tsc --noEmit && eslint .`; add devDependencies `eslint`, `@eslint/js`, `typescript-eslint`, `globals` (today they come from the DE root). |
| `src/version.ts` | package | **Rewrite** | `IMPORTER_VERSION = '1.0.0-rc.2'` must move to `rc.3` in the same commit as `package.json`; `version.spec.ts` fails otherwise. |
| ESLint | DE root `eslint.config.mjs` | **Rewrite** | The package has no ESLint config of its own. The new repository gets a small flat config: the base block (`js.configs.recommended`, `tseslint.configs.recommended`, `no-unused-vars` with `^_`, `eqeqeq`, `prefer-const`), the type-aware `parserOptions.project`, and the three package blocks (lines 136-190): no import of Dynamic Entity, main entry browser-safe, `/node` imports the main entry by name. **Leave** the Angular parts. In DE, remove line 58 and those three blocks in Stage 4. |
| `.prettierrc` | DE root | **Copy** | Same formatting on both sides; no script runs it today. |
| `.npmrc` (`install-strategy=hoisted`) | DE root | **Leave** | It exists for one copy of Angular. The new repository has no Angular. |
| `turbo.json`, workspaces | DE root | **Leave** | One package: plain npm scripts. |
| `package-lock.json` | DE root | **Rewrite** | The new repository generates its own. DE's is regenerated in Stage 4, with care: `scripts/check-lockfile-platforms.mjs` fails a lockfile that has lost foreign-platform binaries. |
| `.gitignore` | DE root | **Rewrite** | `node_modules/`, `dist/`, `coverage/`, `*.tgz`, `*.log`. None of the Angular / Playwright / showcase entries. |
| `LICENSE` | DE root | **Copy** | MIT. Holder reads "Dynamic Entity Team", `package.json` author reads "Nizamudeen": see D4. |
| `SECURITY.md` | DE root | **Rewrite** | Short: point at GitHub private vulnerability reporting. DE's is about DE's three packages. |
| `CONTRIBUTING.md` | DE root | **Rewrite** | New, short (Stage 2 brief): clone, `npm ci`, the gate commands, how to run the DE drift check locally. |
| `.github/ISSUE_TEMPLATE`, `pull_request_template.md` | DE | **Leave** | Not in the brief. |
| `.github/dependabot.yml` | DE | **Leave** | The new repository's own is optional; see D4. DE's changes are Stage 4. |
| `scripts/check-control-chars.mjs` | DE | **Copy** | Walks the whole repository, so it already covers the package. Cheap, and part of today's lint chain. |

---

## 3. Fixtures

| Item | Used by | Action | Notes |
|---|---|---|---|
| `test/fixtures/order/*`, `test/fixtures/student/*` | the package: `acceptance.spec.ts`, `example-json-adapter.spec.ts`, `json-schema-adapter.spec.ts` (all by `join(__dirname, '..', 'test', 'fixtures', ...)`) | **Copy** (moves with the folder) | 11 files, including the 50 KB `schema-mapper.html`. |
| `src/adapter.fixtures.ts`, `src/node/sheet.fixtures.ts`, `src/node/workbook.fixtures.ts` | the package's own specs | **Copy** (moves with the folder) | Already excluded from coverage. |
| `core/test-fixtures/case1_1904_dates.xlsx`, `case2_numeric_identifiers.xlsx`, `case4_complex_sheet.xlsx` | DE `server` and `ngx` `real-world-fixtures.spec.ts` | **Copy** (recommended, D1) | A copy, not a move: DE keeps its own. They then live under `test/fixtures/real-world/`. |
| `core/test-fixtures/generate-fixtures.mjs`, `README.md` | regenerates the three above | **Copy** (with D1) | Only the `exceljs` import and the output path matter. The README's regeneration command is rewritten for the new path. Regenerating changes the file bytes (ExcelJS stamps a timestamp), so tests must, and do, assert contents, not bytes. |
| New spec reading those three files | none yet | **New** (with D1) | Reads them through `xlsxRows` / `readSheet` and asserts what the README says: no 1462-day drift, unsafe integers reported, merged / hidden / formula / duplicate-header behaviour as the rc.2 contract states. |
| `core/test-fixtures/preview-parity.ts` | DE `server/src/run-import.spec.ts`, `ngx .../local-import-transport.spec.ts` | **Leave** | Browser-vs-server parity of DE's adapter. |
| `core/test-fixtures/xlsx-parity.ts` | DE `server` and `ngx` `xlsx-parity.spec.ts`, `check-timezones.mjs` | **Leave** | Same. |
| `core/test-fixtures/problem-fixtures.ts` | DE `core/src/problem-codes.coverage.spec.ts` | **Leave** | DE's config problems. |
| `core/test-fixtures/import-golden-2.5.0.json`, `scripts/generate-import-golden.mjs` | DE `core/src/entity-form-config-adapter.spec.ts`, `check-phase2-parity.mjs` | **Leave** | The record of what published 2.5.0 did. It is a DE fact. |
| `test_data.json` (DE root) | DE | **Leave** | Not used by the package. |

---

## 4. Scripts and CI that cover it

| Item | Today | New repository | DE after Stage 4 |
|---|---|---|---|
| Lint | `npm run lint` at the DE root runs the repo checks, `eslint packages/*/src/**`, then `turbo run lint` (which runs `tsc --noEmit` in the package) | **Rewrite**: `tsc --noEmit` + `eslint` + `check-control-chars` | Package gone from the globs and the ESLint project list. |
| Build | `tsup` through turbo | **Copy**: `npm run build` | Not built here. |
| Test | `jest` | **Copy** | Not run here. |
| Coverage gate | `jest --coverage` against the thresholds in `jest.config.js` | **Copy** (the thresholds travel with the config) | Not run here. |
| Six timezones | `scripts/check-timezones.mjs`: the `importer` suite is `coerce` only | **Rewrite**: a one-suite script. Zones are unchanged (UTC, Los_Angeles, New_York, Berlin, Kolkata, Kiritimati). The `coerce` pattern stays; consider adding `xlsx-source`, whose typed `Date` cells are the other door to the same bug | **Rewrite**: remove the `IMPORTER` suite; `core`, `server`, `ngx` stay. |
| Bundle check | `scripts/check-importer-bundle.mjs`, reads `packages/sheet-to-schema/dist` | **Rewrite**: same logic, `DIST = ./dist` | **Rewrite**: read `node_modules/sheet-to-schema/dist`, so DE still notices a bad published build. |
| Consumer install from the packed tarball | `scripts/verify-consumer.mjs` and `verify-server-consumer.mjs` pack the package from its folder because it was not on npm | **New**, small: `npm pack`, install the tarball into a scratch project, load the main entry as CJS and ESM, load `/node` with and without `exceljs` / `busboy` / `express`, assert the main entry has zero dependencies and the `exports` map resolves. Do not reuse DE's 800-line Angular script | **Rewrite**: stop packing it; it installs from the registry as a normal dependency. The "not on npm" comments go. |
| `fresh-scenarios` suite | `src/fresh-scenarios.spec.ts` (39 KB), runs inside the normal `jest` run; no `--expose-gc`, no outside input | **Copy** | Not run here. Its heap bounds were proven able to fail on this machine's Node; they are checked again on the new CI's Node. |
| Phase 2 parity gate | `scripts/check-phase2-parity.mjs`, `npm run check:parity` | **Rewrite**: only what concerns the package (no import cycle in `src`, repository metadata, main entry has no Node) | **Rewrite**: see section 6. |
| Release | `.github/workflows/release.yml`, five packages | **New**: tag-triggered, `environment: npm`, provenance, the dist-tag logic, `--loglevel verbose` | **Rewrite**: four packages. |
| CI | `.github/workflows/ci.yml` | **New** | **Rewrite**: one comment (lines 41-44) names the package. |
| `e2e.yml`, `pages.yml` | no reference to the package | n/a | **Leave**. They `npm ci`, so they need `sheet-to-schema@1.0.0-rc.3` on npm: another reason Stage 3 precedes Stage 4. |
| `check-build-graph.mjs` | asks turbo which sibling imports have no build edge | n/a | **Leave**. The package stops being a workspace, so it has no `#build` task and is skipped. |

---

## 5. History

Filter in a **fresh clone**; never in the working copy.

```bash
pip install git-filter-repo            # not installed; Python 3.14 and git 2.52 are present
git clone --no-local <DE working copy> sheet-to-schema-extract
cd sheet-to-schema-extract
git filter-repo \
  --path packages/sheet-importer/  --path-rename packages/sheet-importer/: \
  --path packages/sheet-to-schema/ --path-rename packages/sheet-to-schema/:
```

- The two-path form keeps the 13 Phase 1 commits at the old path. `420eec6`, the pure rename,
  becomes empty and is pruned. Expect about 41 commits; Stage 2 reports the real number and
  checks `git log --follow` on a few files, for example `src/coerce.ts` back to `f1312b3`.
- Commits that touched DE and the package together are reduced to their package part.
- The clone carries DE's tags (`v3.0.0-rc.1`, `v3.0.0-rc.2`, and older). **Delete every tag and
  every branch except `main` before pushing, and push `main` only.** A `v*` tag in the new
  repository would trigger its release workflow.
- No commit message under the package carries a `#NNN` reference, so none will point at the
  wrong repository's issues.
- The package's own history starts at `f955f56`. The CHANGELOG note in the brief is accurate
  in this sense: what came before is the design and prototype work in DE
  (`docs/import-phase1-spec.md`, `docs/import-extraction-analysis.md`, the prototype fixtures
  at `7595f23`), which stays there.

---

## 6. Everything in DE that reads the package from source

| Item | Reads it how | Action in Stage 4 |
|---|---|---|
| `packages/server/jest.config.js` `moduleNameMapper` (lines 20-21) | maps `sheet-to-schema` and `sheet-to-schema/node` to `../sheet-to-schema/src/...` | **Rewrite**: delete the mapping. See R1: the file's own comment says why it exists. |
| `packages/core/package.json:36`, `packages/server/package.json:76` | dependency `"sheet-to-schema": "1.0.0-rc.2"`, resolved today through the workspace link | **Rewrite**: `1.0.0-rc.3` exact; `^1.0.0` at the finals. `core/build-manifest.mjs` passes `dependencies` through unchanged, so the published manifest follows. |
| `scripts/check-phase2-parity.mjs` | five uses | **Rewrite**: see below. |
| `scripts/check-importer-bundle.mjs` | `DIST = packages/sheet-to-schema/dist` | **Rewrite**: `node_modules/sheet-to-schema/dist`. |
| `scripts/check-timezones.mjs` | `IMPORTER` suite | **Rewrite**: remove it. |
| `scripts/verify-consumer.mjs` (lines 143-150, 197), `verify-server-consumer.mjs` (lines 70-76, 99) | packs the folder, installs the tarball | **Rewrite**: install from the registry. `verify-consumer.mjs` also asserts `core` has no nested `node_modules`: keep that, it still proves one copy. |
| `.github/workflows/release.yml` | comment lines 65-68, registry-existence loop (176), "All five packages" (205), ordering comment (213-224), publish step (230-254), dry-run pack (304) | **Rewrite**: remove the step and the loop entry; four packages. The `--loglevel verbose` moves to the new repository's release. |
| `.github/workflows/ci.yml` lines 41-44 | comment | **Rewrite**: wording only. |
| `eslint.config.mjs` | line 58 (`parserOptions.project`) and three rule blocks (136-190) | **Rewrite**: remove them. |
| Repository-field check | `check-phase2-parity.mjs` section 4: `PUBLISHABLE` lists five packages | **Rewrite**: four. The new repository has its own check with its own URL. |
| `README.md:410`, `docs/MIGRATING-3.0.md` (9 hits), `CONTRIBUTING.md` ("Adding a fourth (or fifth) published package") | links to `./packages/sheet-to-schema` | **Rewrite** to the new repository; add the pointer "moved to github.com/berserker5619/sheet-to-schema". |
| `CHANGELOG.md`, `docs/phase2-plan.md`, `docs/import-phase1-spec.md`, `docs/rc-feedback.md` | history | **Leave**. They are records of what was true then. |
| `packages/core/src/*`, `packages/server/src/*` | `from 'sheet-to-schema'` and `'sheet-to-schema/node'` imports, 21 files (10 in `core`, 11 in `server`) | **Leave**. These are package imports and stay valid. |

`check-phase2-parity.mjs`, section by section:

| Section | Today | After |
|---|---|---|
| 1. SUITES | line 62 requires `packages/sheet-to-schema/src/acceptance.spec.ts`; line 54 requires the words `IMPORTER` in `check-timezones.mjs` | Remove line 62 (the acceptance test is the new repository's to hold). Change line 54's words to what is left. |
| 2. BROWSER_BUNDLES | `packages/sheet-to-schema/dist/index.{js,mjs}` | `node_modules/sheet-to-schema/dist/index.{js,mjs}` |
| 3. package graph | `packages/sheet-to-schema/dist/...` entries for both entries | `node_modules/sheet-to-schema/dist/...`; keep the "imports nothing of Dynamic Entity's" check, it is cheap and runs on the published build. |
| 3. source cycles | loops over `packages/sheet-to-schema/src` | Remove that entry; `core` and `server` stay. The new repository checks its own `src`. |
| 4. repository metadata | five packages, `Dynamic-Entity.git`, `directory` per package | Four packages. |

---

## 7. Risks and decisions

### Risks to settle before they cost a release

**R1. The server's Jest suites may not run against the built package.** The comment at
`packages/server/jest.config.js:15-19` says the source mapping exists because the built CommonJS
entry loads `exceljs` and `busboy` with a real `import()`, "which Node runs and Jest's module
sandbox does not". Removing the mapping (Stage 4's requirement) can therefore turn the server's
suites red for a reason inside sheet-to-schema's build, which would mean a fourth release,
`rc.4`, to fix it. Proposal: find out in Stage 2, before anything is published. Pack rc.3, install
the tarball into a **scratch copy** of DE, delete the mapping there and run the server and core
suites. Known ways out if it fails: `NODE_OPTIONS=--experimental-vm-modules` in the server's
`test` script, or a tsup option so the CJS build loads the peers with `require`. The first is a
DE-only change; the second must land in rc.3. Nothing in DE is committed by this check.

**R2. A second `npm` entry in `dependabot.yml` is not allowed.** Dependabot requires each
`package-ecosystem` + `directory` pair to be unique, and DE's one `npm` entry at `/` is
deliberately single, because the workspaces share one lockfile (the file's own comment). So
"Dependabot for sheet-to-schema, daily" cannot be a separate entry. Options for Stage 4:
- **A (default, matches the brief literally):** set the one `npm` entry to `daily`. The toolchain
  groups and `open-pull-requests-limit: 5` bound the noise, but all of it arrives daily, not
  weekly.
- **B:** keep the weekly entry, add a `sheet-to-schema` group to it, and rely on the daily drift
  job for early warning. Not literally daily Dependabot.
- A separate entry on `/packages/server` is not an option: `core` and `server` both declare the
  dependency, and a PR touching one leaves the lockfile half-moved.

Also: the entry's `ignore: '*'` for `semver-major` hides a `sheet-to-schema` 2.0 PR. That is
probably right for a toolchain, and wrong for the package DE is built on. It cannot be
exempted by name inside the same entry, so the drift job (`@latest`) is what would show a 2.0.

**R3. The drift job must not install two copies.** DE's packages pin the rc exactly. A bare
`npm install sheet-to-schema@latest --no-save` at the root can leave `core` and `server`
resolving their own pinned copy beside it, so the job would test the pin and report it as
`@latest`. The job should set `overrides.sheet-to-schema` to the resolved version, install, and
assert `npm ls sheet-to-schema` shows one version. Until 1.0.0, `latest` and `next` are the
same rc, so the two runs are identical; the matrix is still worth having for the day they split.

**R4. The earlier OIDC `E404` is still unexplained.** The cause was never shown: that is why the
manual publish was needed. The most likely suspect was the `repository` field not matching the
workflow's repository, which the new repository fixes by construction. The new `release.yml`
keeps `--loglevel verbose`, and Stage 3 stops and shows the full log on any failure, as the brief
says.

**R5. Keep rc.3 code-identical to rc.2.** The only changes between `1.0.0-rc.2` and `1.0.0-rc.3`
should be the manifest, `IMPORTER_VERSION`, links and comments, plus any packaging fix R1 forces.
That way every DE result already proven against rc.2 still holds for rc.3, and a failure after
the move is the move's.

**R6. `engines` says Node `>=18`; every CI run to date has been Node 24.** The consumer-install
check is the place to cover the floor if the new CI should (see D4).

### Decisions I need, with the default I will take if you just say "go"

- **D1. Copy the three real-world `.xlsx` fixtures, the generator and its README, and add one
  spec that reads them (finding 4).** Default: **yes.** Without it the new repository cannot
  catch a 1904 or merged-cell regression itself. This is the only new test code in the plan.
- **D2. Run the R1 spike in Stage 2.** Default: **yes.** It costs one scratch install and is
  the only way to learn about R1 before rc.3 exists.
- **D3. `docs/import-phase1-spec.md` (89 KB), the package's contract.** Default: **copy it to
  `docs/` in the new repository** and leave DE's copy with a pointer; link `phase2-plan.md`,
  which is about DE, by URL instead of copying it.
- **D4. Small items not in the brief.** Defaults: the new repository gets its own minimal
  `dependabot.yml` (weekly, npm and Actions); CI runs Node 24 for the full gate and 20 and 22
  for build + test; LICENSE copied as it stands ("Dynamic Entity Team"); no issue or PR
  templates.
- **D5. Dependabot, R2.** Default: **option A.**
