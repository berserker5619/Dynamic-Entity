# Round 3 RC test harnesses

The scripts behind "Round 3" in [`docs/rc-feedback.md`](../../docs/rc-feedback.md): the final
release-candidate test of `sheet-to-schema@1.0.0-rc.3` and Dynamic Entity `3.0.0-rc.3`,
run **against the packages published on npm, never this repository's source**. Nothing here is
a workspace, nothing here is published, and no CI job runs it. It is kept so the round can be
repeated against a later release: change the versions the projects install, rerun, compare.

Each case runs in a **fresh project outside the monorepo**, so that npm resolves the packages
as a user's install would. Create the project in a scratch directory, install from the
registry, copy the case's files in, run. Node 20 or later.

| Case | What it checks | Files |
|---|---|---|
| a | One copy of `sheet-to-schema` beside `@dynamic-entity/core` | (commands below) |
| b | A CommonJS Express 4 and 5 server, and a CommonJS Jest suite with no Node flags | `b-server/` |
| c | TypeScript strict with `skipLibCheck` off, on `@types/express` 4, 5 and none | `c-typings/` |
| d | The Angular wizard end to end, with screenshots | `d-angular/` |
| e | Round 2's real-world files through the browser and server paths | `e-realworld/`, `files/` |

`files/` holds the real-world workbooks and CSVs; `files/build_files.py` (openpyxl 3.1.5)
generated them in Round 2. `case5_non_latin.xlsx` must stay the openpyxl-written binary: it
stores text as numeric character references, which is what R3-1 is about.

Set `VERSION_DE` and `VERSION_S2S` to what you are testing (`next`, or an exact version).

## a. One copy of the engine

```bash
mkdir a && cd a && npm init -y
npm install @dynamic-entity/core@$VERSION_DE sheet-to-schema@$VERSION_S2S
npm ls sheet-to-schema        # one version, deduplicated under core
```

## b. CommonJS server and Jest (express 4, then 5)

```bash
mkdir b4 && cd b4 && npm init -y
npm install @dynamic-entity/server@$VERSION_DE @dynamic-entity/core@$VERSION_DE express@4
npm install -D jest@30
cp ../test-harness/rc-round3/b-server/* .
export R3_FILES=../test-harness/rc-round3/files
node server-check.cjs                                    # 5 checks; writes results.json
env -u NODE_OPTIONS node node_modules/jest/bin/jest.js server.test.js
```

Repeat with `express@5`. The scripts must sit in the project directory: `require` resolves
from the script's location.

## c. Typings

```bash
mkdir c5 && cd c5 && npm init -y
npm install @dynamic-entity/server@$VERSION_DE @dynamic-entity/core@$VERSION_DE express@5 \
  typescript@~5.9.3 @types/node@20 @types/express@5
cp ../test-harness/rc-round3/c-typings/*.ts .
for f in de-plain de-typed s2s-typed; do
  npx tsc --noEmit --strict --skipLibCheck false --target ES2022 --module nodenext \
    --moduleResolution nodenext --esModuleInterop --types node $f.ts
done
```

Repeat with `@types/express@4`. For "none", install without `@types/express` and compile
`de-only.ts`. In Round 3 `de-typed.ts` failed with TS2322 on both majors (R3-2) and `de-only.ts`
with TS7016 (R3-3); from `3.0.0-rc.4` all of them should compile.

## d. Angular wizard

```bash
cp -r test-harness/rc-round3/d-angular ../r3-angular && cd ../r3-angular
npm install                    # package.json installs the @next tags; pin versions if needed
npx playwright install chromium
npx ng build
node server.mjs &              # API on :4321, the built app on :4200
node drive_part_b.mjs          # screenshots 01-11 into docs/rc-screens/round3
```

`R3_SCREENS` sends the screenshots elsewhere; `PW_CHROMIUM` points Playwright at a specific
Chromium binary.

## e. Real-world files through both paths

```bash
cp -r test-harness/rc-round3/e-realworld ../r3-e && cd ../r3-e
npm install                    # includes SheetJS 0.20.3 from cdn.sheetjs.com
R3_FILES=../test-harness/rc-round3/files node run.mjs    # writes round3-e.json
```

The browser path does what `LocalImportTransport` does with a `sheetParser`; for `.xlsx` it uses
the SheetJS parser EXTENDING.md documented at the time, which is how Round 3 found R3-1.
`emoji.mjs` and `cp.mjs` isolate that defect. Each case is compared across the two paths and
with Round 2's recorded output (`round2-summary.json`).
