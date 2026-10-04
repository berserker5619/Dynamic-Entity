# demo-angular

The showcase application and the home of the Playwright E2E suite. **Not published** — it
exists to exercise the packages and to be something you can click through.

```bash
npm run dev --workspace=demo-angular   # http://localhost:4200
```

## What it demonstrates

- Every field type, rendered from the configs in `../../test_data.json`, plus three larger
  industry schemas — Insurance Claims, Patient Intake & Clinical Triage, and IT Asset & Fleet
  Lifecycle (`src/app/mock/configs/`)
- The three record presentations — Form, Record view and Data only — and a list view
- The role switcher, showing masking and `permissions.view` in action
- The interface-language switch, with a German pack for both libraries' chrome
  (`src/app/mock/ui-text-de.ts`)
- The visual builder with live preview, the rule & dependency graph and the regex playground
- The spreadsheet import wizard, in the browser by default
- A Light / Dark / Auto theme switch, and a Live JSON Inspector drawer showing the current
  config and record, with copy and download
- Records persisted to `localStorage` via a mock store, so there is no backend to run

## Importing through the server

The wizard runs in the browser unless you open the app with `?transport=http`. Then it posts
the file to `import-server.mjs`, a small Express app using `@dynamic-entity/server`, which the
dev server proxies at `/api/import` (`proxy.conf.json`) so the browser sees one origin, as a
real deployment would:

```bash
node packages/demo-angular/import-server.mjs   # port 4300, or IMPORT_PORT
npm run dev --workspace=demo-angular           # then open http://localhost:4200/?transport=http
```

That mode also reads `.xlsx` uploads, which the browser path does not without a registered
`sheetParser`.

## Its stylesheet is a reference

`src/styles.css` is a fuller treatment than the optional base stylesheet the renderer ships
(`ngx-dynamic-entity/styles.css`). If you want to see how far the BEM hooks can be taken,
read it.

## E2E

```bash
npm run e2e                             # from the repo root
npx playwright test e2e/demo.spec.ts    # one spec, from here
```

`test-data-json-rendering.spec.ts` is the one worth knowing about: it asserts that every field
type in `test_data.json` exists in the catalog, fails on any `[ngx-dynamic-entity]` console
warning, and requires a tab declaring fields to actually render controls. It previously watched
only for uncaught exceptions and so passed green over three field types the renderer refused
to draw.

The full suite is slow — `playwright.config.ts` sets `workers: 1` and two builder specs drive
hundreds of interactions each — so CI runs a fast subset per pull request and the whole thing
nightly.
